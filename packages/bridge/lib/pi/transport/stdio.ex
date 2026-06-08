defmodule Pi.Transport.Stdio do
  @moduledoc "Line-delimited JSON transport for extension-owned BEAM sessions."

  alias Pi.Agent.Registry, as: AgentRegistry
  alias Pi.Bridge.Info
  alias Pi.Integrations
  alias Pi.LLM.Broker
  alias Pi.MCP.Tools
  alias Pi.Plugin.Event
  alias Pi.Plugin.Manager
  alias Pi.Protocol.Call
  alias Pi.Protocol.LLM.Chunk
  alias Pi.Protocol.LLM.Done
  alias Pi.Protocol.LLM.Error
  alias Pi.Protocol.Ready
  alias Pi.Protocol.Request
  alias Pi.Protocol.Response
  alias Pi.Protocol.Result
  alias Pi.Skill.Loader

  def emit_request(id, op, payload) when is_binary(id) and is_atom(op) and is_map(payload) do
    emit(%Request{type: :request, id: id, op: op, payload: payload})
  end

  def emit(payload) when is_map(payload) do
    case :persistent_term.get({__MODULE__, :pid}, nil) do
      nil -> :ok
      pid -> send(pid, {:pi_transport_emit, payload |> to_payload() |> normalize()})
    end
  end

  @doc false
  def __test_payload__(payload), do: payload |> to_payload() |> normalize()

  def start do
    :persistent_term.put({__MODULE__, :pid}, self())
    Event.install()
    Manager.install()
    Broker.install()
    AgentRegistry.install()
    ready()
    emit_integration_statuses()

    parent = self()

    spawn_link(fn ->
      IO.stream(:stdio, :line)
      |> Enum.each(&send(parent, {:stdin, &1}))
    end)

    loop()
  end

  defp loop do
    receive do
      {:stdin, line} ->
        handle_line(line)
        loop()

      {:pi_transport_emit, payload} ->
        write(payload)
        loop()
    end
  end

  defp handle_line(line) do
    case Jason.decode(line) do
      {:ok, %{"type" => "call"} = request} ->
        call = Call.from_map!(request)
        spawn(fn -> respond(call.id, dispatch(call.name, call.arguments)) end)

      {:ok, %{"type" => "response"} = response} ->
        response = Response.from_map!(response)
        Broker.deliver(response.id, response)

      {:ok, %{"type" => "llm_chunk"} = chunk} ->
        chunk = Chunk.from_map!(chunk)
        send(self(), {:pi_llm_chunk, chunk.id, chunk.delta})

      {:ok, %{"type" => "llm_done"} = done} ->
        done = Done.from_map!(done)
        send(self(), {:pi_llm_done, done.id, done.result})

      {:ok, %{"type" => "llm_error"} = error} ->
        error = Error.from_map!(error)
        send(self(), {:pi_llm_error, error.id, error.error})

      _ ->
        :ok
    end
  rescue
    _ -> :ok
  end

  defp dispatch("pi_skills_list", _args) do
    {:ok, encode_structs(Loader.serializable())}
  end

  defp dispatch("pi_event", args) do
    Event.push(args)
    Manager.dispatch_event(args)
    {:ok, "ok"}
  end

  defp dispatch("pi_bridge_info", _args) do
    {:ok, Jason.encode!(Info.snapshot(:stdio))}
  end

  defp dispatch("pi_bridge_apis", _args) do
    {:ok, encode_structs(Info.apis())}
  end

  defp dispatch("pi_apis", _args) do
    {:ok, encode_structs(Info.runtime_apis())}
  end

  defp dispatch(name, args), do: Tools.dispatch(name, args)

  defp respond(id, {:ok, text}) do
    write(%Result{type: :result, id: id, text: text, is_error: false})
  end

  defp respond(id, {:error, message}) do
    write(%Result{type: :result, id: id, text: message, is_error: true})
  end

  defp ready, do: write(%Ready{type: :ready, info: Info.snapshot(:stdio)})

  defp emit_integration_statuses do
    Enum.each(Integrations.statuses(), fn %{key: key, text: text} ->
      write(%Pi.Protocol.UIEvent{type: :ui, op: :status, key: key, text: text})
    end)
  end

  defp encode_structs(values) do
    values
    |> Enum.map(&to_payload/1)
    |> Jason.encode!()
  end

  defp write(payload) do
    IO.write([Jason.encode!(payload |> to_payload() |> normalize()), ?\n])
  end

  defp to_payload(%Result{} = result) do
    %{
      type: result.type,
      id: result.id,
      text: result.text,
      isError: result.is_error
    }
  end

  defp to_payload(%module{} = struct) do
    if function_exported?(module, :to_map, 1),
      do: module.to_map(struct),
      else: Map.from_struct(struct)
  end

  defp to_payload(map) when is_map(map), do: map

  defp normalize(map) when is_map(map) do
    Map.new(map, fn {key, value} -> {key, normalize_value(value)} end)
  end

  defp normalize_value(%_module{} = value), do: value |> to_payload() |> normalize()
  defp normalize_value(value) when is_boolean(value), do: value
  defp normalize_value(nil), do: nil
  defp normalize_value(value) when is_atom(value), do: Atom.to_string(value)
  defp normalize_value(value) when is_map(value), do: normalize(value)
  defp normalize_value(value) when is_list(value), do: Enum.map(value, &normalize_value/1)
  defp normalize_value(value), do: value
end
