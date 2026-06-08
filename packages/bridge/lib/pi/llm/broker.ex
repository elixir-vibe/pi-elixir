defmodule Pi.LLM.Broker do
  @moduledoc "Multiplexes BEAM-initiated LLM requests over the active pi transport."

  use GenServer

  alias Pi.Transport.Stdio

  @timeout 60_000

  def start_link(opts \\ []), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  def install do
    case Process.whereis(__MODULE__) do
      nil -> start_link([])
      _pid -> :ok
    end
  end

  def complete(messages, opts \\ []) do
    request(
      :llm_complete,
      %{messages: messages, opts: Map.new(opts)},
      Keyword.get(opts, :timeout, @timeout)
    )
  end

  def request(op, payload, timeout \\ @timeout) when is_atom(op) and is_map(payload) do
    install()
    GenServer.call(__MODULE__, {:request, op, payload, timeout}, timeout + 1_000)
  end

  def deliver(id, result) when is_binary(id) do
    install()
    GenServer.cast(__MODULE__, {:deliver, id, result})
  end

  @impl true
  def init(_opts), do: {:ok, %{next_id: 0, pending: %{}}}

  @impl true
  def handle_call({:request, op, payload, timeout}, from, state) do
    id = request_id(state.next_id + 1)
    timer = Process.send_after(self(), {:timeout, id}, timeout)
    Stdio.emit_request(id, op, payload)

    pending = Map.put(state.pending, id, %{from: from, timer: timer})
    {:noreply, %{state | next_id: state.next_id + 1, pending: pending}}
  end

  @impl true
  def handle_cast({:deliver, id, result}, state) do
    {:noreply, reply(state, id, normalize_result(result))}
  end

  @impl true
  def handle_info({:timeout, id}, state) do
    {:noreply, reply(state, id, {:error, "Pi LLM request timed out"})}
  end

  defp reply(state, id, result) do
    case Map.pop(state.pending, id) do
      {nil, _pending} ->
        state

      {%{from: from, timer: timer}, pending} ->
        Process.cancel_timer(timer)
        GenServer.reply(from, result)
        %{state | pending: pending}
    end
  end

  defp normalize_result(%{"ok" => true, "result" => result}), do: {:ok, result}
  defp normalize_result(%{"ok" => false, "error" => error}), do: {:error, error}
  defp normalize_result(%{ok: true, result: result}), do: {:ok, result}
  defp normalize_result(%{ok: false, error: error}), do: {:error, error}
  defp normalize_result(result), do: {:ok, result}

  defp request_id(next_id), do: "llm_#{System.unique_integer([:positive])}_#{next_id}"
end
