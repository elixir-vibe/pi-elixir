defmodule Pi.Transport.Stdio do
  @moduledoc "Line-delimited JSON transport for extension-owned BEAM sessions."

  alias Pi.Bridge.Info
  alias Pi.Integrations
  alias Pi.LLM.Broker
  alias Pi.MCP.Tools
  alias Pi.Plugin.Event
  alias Pi.Plugin.Manager
  alias Pi.Skill.Loader

  def emit_request(id, op, payload) when is_binary(id) and is_atom(op) and is_map(payload) do
    emit(%{type: :request, id: id, op: op, payload: payload})
  end

  def emit(payload) when is_map(payload) do
    case :persistent_term.get({__MODULE__, :pid}, nil) do
      nil -> :ok
      pid -> send(pid, {:pi_transport_emit, normalize(payload)})
    end
  end

  def start do
    :persistent_term.put({__MODULE__, :pid}, self())
    Event.install()
    Manager.install()
    Broker.install()
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
      {:ok, %{"type" => "call", "id" => id, "name" => name} = request} ->
        args = Map.get(request, "arguments", %{})
        respond(id, dispatch(name, args))

      {:ok, %{"type" => "response", "id" => id} = response} ->
        Broker.deliver(id, Map.drop(response, ["type", "id"]))

      _ ->
        :ok
    end
  rescue
    _ -> :ok
  end

  defp dispatch("pi_skills_list", _args) do
    {:ok, Jason.encode!(Loader.serializable())}
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
    {:ok, Jason.encode!(Enum.map(Info.apis(), &api_to_map/1))}
  end

  defp dispatch(name, args), do: Tools.dispatch(name, args)

  defp respond(id, {:ok, text}) do
    write(%{type: :result, id: id, text: text, isError: false})
  end

  defp respond(id, {:error, message}) do
    write(%{type: :result, id: id, text: message, isError: true})
  end

  defp ready, do: write(%{type: :ready, info: Info.snapshot(:stdio)})

  defp emit_integration_statuses do
    Enum.each(Integrations.statuses(), fn %{key: key, text: text} ->
      write(%{type: :ui, op: :status, key: key, text: text})
    end)
  end

  defp api_to_map(api) do
    %{
      name: api.name,
      alias: api.alias,
      module: inspect(api.module),
      description: api.description,
      examples: api.examples
    }
  end

  defp write(payload) do
    IO.write([Jason.encode!(payload), ?\n])
  end

  defp normalize(map) when is_map(map) do
    Map.new(map, fn {key, value} -> {key, normalize_value(value)} end)
  end

  defp normalize_value(value) when is_atom(value), do: Atom.to_string(value)
  defp normalize_value(value) when is_map(value), do: normalize(value)
  defp normalize_value(value) when is_list(value), do: Enum.map(value, &normalize_value/1)
  defp normalize_value(value), do: value
end
