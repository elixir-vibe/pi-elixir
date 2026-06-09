defmodule Pi.Session.Worker do
  @moduledoc "Server-owned Pi session process with subscribers and LLM-backed runs."

  use GenServer

  alias Pi.Protocol.LLM.Message
  alias Pi.Protocol.Session.Snapshot
  alias Pi.Session.Event
  alias Pi.Session.State

  @timeout 60_000

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts)
  end

  def id(pid), do: state(pid).id
  def state(pid), do: GenServer.call(pid, :state)
  def snapshot(pid), do: GenServer.call(pid, :snapshot)
  def subscribe(pid, subscriber \\ self()), do: GenServer.call(pid, {:subscribe, subscriber})
  def detach(pid, subscriber \\ self()), do: GenServer.call(pid, {:detach, subscriber})

  def run(pid, prompt, opts \\ []) when is_binary(prompt) do
    GenServer.call(pid, {:run, prompt, opts}, Keyword.get(opts, :timeout, @timeout) + 1_000)
  end

  def complete(pid, opts \\ []) do
    GenServer.call(pid, {:complete, opts}, Keyword.get(opts, :timeout, @timeout) + 1_000)
  end

  def append(pid, message), do: GenServer.call(pid, {:append, message})
  def cancel(pid), do: GenServer.call(pid, :cancel)

  def rerun(pid, opts \\ []),
    do: GenServer.call(pid, {:rerun, opts}, Keyword.get(opts, :timeout, @timeout) + 1_000)

  @impl true
  def init(opts) do
    {:ok,
     %{
       state: State.new(opts),
       ask_fun: Keyword.get(opts, :ask_fun, &ask/2),
       stream_fun: Keyword.get(opts, :stream_fun, &stream/2),
       subscribers: %{},
       task: nil,
       task_ref: nil,
       caller: nil
     }}
  end

  @impl true
  def handle_call(:state, _from, data), do: {:reply, data.state, data}
  def handle_call(:snapshot, _from, data), do: {:reply, to_snapshot(data.state), data}

  def handle_call({:subscribe, subscriber}, _from, data) when is_pid(subscriber) do
    ref = Process.monitor(subscriber)
    {:reply, {:ok, data.state}, %{data | subscribers: Map.put(data.subscribers, ref, subscriber)}}
  end

  def handle_call({:detach, subscriber}, _from, data) when is_pid(subscriber) do
    {removed, subscribers} =
      Enum.split_with(data.subscribers, fn {_ref, pid} -> pid == subscriber end)

    Enum.each(removed, fn {ref, _pid} -> Process.demonitor(ref, [:flush]) end)
    {:reply, :ok, %{data | subscribers: Map.new(subscribers)}}
  end

  def handle_call({:append, message}, _from, data) do
    data = update_state(data, fn state -> append_message(state, message) end)
    {:reply, :ok, data}
  end

  def handle_call(:cancel, _from, %{task: nil} = data) do
    data = transition(data, :cancelled, Event.new(:cancelled))
    {:reply, :ok, data}
  end

  def handle_call(:cancel, _from, %{task: task} = data) do
    Task.shutdown(task, :brutal_kill)

    data =
      data
      |> Map.merge(%{task: nil, task_ref: nil})
      |> transition(:cancelled, Event.new(:cancelled))
      |> reply({:error, :cancelled})

    {:reply, :ok, data}
  end

  def handle_call({:run, prompt, opts}, from, %{task: nil} = data) do
    data = data |> update_state(&append_message(&1, %Message{role: :user, content: prompt}))
    start_completion(data, from, opts)
  end

  def handle_call({:run, _prompt, _opts}, _from, data) do
    {:reply, {:error, :busy}, data}
  end

  def handle_call({:rerun, opts}, from, %{task: nil} = data) do
    case last_user_message(data.state) do
      nil -> {:reply, {:error, :no_user_message}, data}
      prompt -> handle_call({:run, prompt, opts}, from, data)
    end
  end

  def handle_call({:rerun, _opts}, _from, data) do
    {:reply, {:error, :busy}, data}
  end

  def handle_call({:complete, opts}, from, %{task: nil} = data) do
    start_completion(data, from, opts)
  end

  def handle_call({:complete, _opts}, _from, data) do
    {:reply, {:error, :busy}, data}
  end

  @impl true
  def handle_info({:session_delta, delta}, data) when is_binary(delta) do
    data = transition(data, :running, Event.new(:delta, %{delta: delta}))
    {:noreply, data}
  end

  def handle_info({ref, {:ok, result}}, %{task_ref: ref} = data) do
    Process.demonitor(ref, [:flush])

    data =
      data
      |> update_state(&append_message(&1, %Message{role: :assistant, content: result}))
      |> complete(:done, result, nil, Event.new(:done, %{result: result}))
      |> reply({:ok, result})

    {:noreply, data}
  end

  def handle_info({ref, {:error, reason}}, %{task_ref: ref} = data) do
    Process.demonitor(ref, [:flush])

    data =
      data
      |> complete(:failed, nil, reason, Event.new(:failed, %{error: inspect(reason)}))
      |> reply({:error, reason})

    {:noreply, data}
  end

  def handle_info({:DOWN, ref, :process, _pid, _reason}, %{task_ref: ref} = data) do
    data =
      data
      |> complete(:failed, nil, :down, Event.new(:failed, %{error: "down"}))
      |> reply({:error, :down})

    {:noreply, data}
  end

  def handle_info({:DOWN, ref, :process, _pid, _reason}, data) do
    {:noreply, %{data | subscribers: Map.delete(data.subscribers, ref)}}
  end

  defp start_completion(data, from, opts) do
    data = transition(data, :running, Event.new(:started))
    messages = messages(data.state)
    ask_fun = data.ask_fun
    stream_fun = data.stream_fun
    timeout = Keyword.get(opts, :timeout, @timeout)

    owner = self()

    task =
      Task.async(fn ->
        if Keyword.get(opts, :stream, false) do
          safe_stream(stream_fun, messages, Keyword.put(opts, :timeout, timeout), owner)
        else
          safe_ask(ask_fun, messages, Keyword.put(opts, :timeout, timeout))
        end
      end)

    data =
      transition(
        %{data | task: task, task_ref: task.ref, caller: from},
        :running,
        Event.new(:llm)
      )

    {:noreply, data}
  end

  defp ask(messages, opts), do: Pi.LLM.complete(messages, opts)
  defp stream(messages, opts), do: Pi.LLM.stream(messages, opts)

  defp last_user_message(%State{messages: messages}) do
    messages
    |> Enum.reverse()
    |> Enum.find_value(fn
      %Message{role: :user, content: content} -> content
      _message -> nil
    end)
  end

  defp safe_ask(ask_fun, messages, opts) do
    ask_fun.(messages, opts)
  rescue
    exception -> {:error, Exception.message(exception)}
  catch
    kind, reason -> {:error, {kind, reason}}
  end

  defp safe_stream(stream_fun, messages, opts, owner) do
    stream = stream_fun.(messages, opts)

    text =
      stream.stream
      |> Enum.map(fn delta ->
        send(owner, {:session_delta, to_string(delta)})
        to_string(delta)
      end)
      |> Enum.join()

    {:ok, text}
  rescue
    exception -> {:error, Exception.message(exception)}
  catch
    kind, reason -> {:error, {kind, reason}}
  end

  defp messages(%State{system: nil, messages: messages}), do: messages

  defp messages(%State{system: system, messages: messages}) do
    [%Message{role: :system, content: system} | messages]
  end

  defp append_message(%State{messages: messages} = state, message) do
    %{
      state
      | messages: messages ++ [Pi.Agent.Messages.normalize(message)],
        updated_at: DateTime.utc_now()
    }
  end

  defp transition(data, status, event) do
    update_state(data, fn state ->
      %{state | status: status, events: state.events ++ [event], updated_at: event.at}
    end)
  end

  defp complete(data, status, result, error, event) do
    data
    |> transition(status, event)
    |> Map.merge(%{task: nil, task_ref: nil})
    |> update_state(fn state -> %{state | result: result, error: error} end)
  end

  defp reply(%{caller: nil} = data, _result), do: data

  defp reply(%{caller: caller} = data, result) do
    GenServer.reply(caller, result)
    %{data | caller: nil}
  end

  defp update_state(data, fun) do
    state = fun.(data.state)
    broadcast(data.subscribers, state)
    %{data | state: state}
  end

  defp broadcast(subscribers, state) do
    Enum.each(subscribers, fn {_ref, pid} -> send(pid, {:pi_session, state.id, state}) end)
    Pi.Plugin.Event.emit("pi_session", %{session: to_snapshot(state)})
  end

  defp to_snapshot(%State{} = state) do
    %Snapshot{
      id: state.id,
      parent_id: state.parent_id,
      name: name(state.name),
      status: Atom.to_string(state.status),
      result: state.result,
      error: error(state.error),
      started_at: datetime(state.started_at),
      updated_at: datetime(state.updated_at),
      duration_ms: duration_ms(state),
      prompt: prompt_text(state),
      response: response_text(state),
      message_count: length(state.messages),
      latest: latest_text(state),
      events: Enum.map(state.events, &event/1)
    }
  end

  defp name(nil), do: nil
  defp name(value), do: to_string(value)

  defp error(nil), do: nil
  defp error(value) when is_binary(value), do: value
  defp error(value), do: inspect(value)

  defp datetime(nil), do: nil
  defp datetime(%DateTime{} = datetime), do: DateTime.to_iso8601(datetime)

  defp duration_ms(%State{
         started_at: %DateTime{} = started_at,
         updated_at: %DateTime{} = updated_at
       }) do
    DateTime.diff(updated_at, started_at, :millisecond)
  end

  defp duration_ms(_state), do: nil

  defp prompt_text(%State{messages: messages}), do: last_text_for_role(messages, :user)
  defp response_text(%State{messages: messages}), do: last_text_for_role(messages, :assistant)

  defp latest_text(%State{result: result}) when is_binary(result) and result != "", do: result

  defp latest_text(%State{messages: messages}) do
    messages
    |> Enum.reverse()
    |> Enum.find_value(fn
      %Message{content: content} when is_binary(content) and content != "" -> content
      _message -> nil
    end)
  end

  defp last_text_for_role(messages, role) do
    messages
    |> Enum.reverse()
    |> Enum.find_value(fn
      %Message{role: ^role, content: content} when is_binary(content) and content != "" -> content
      _message -> nil
    end)
  end

  defp event(%Event{} = event) do
    %Pi.Protocol.Session.Event{
      type: Atom.to_string(event.type),
      at: datetime(event.at),
      data: event.data
    }
  end
end
