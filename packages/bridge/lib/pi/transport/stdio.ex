defmodule Pi.Transport.Stdio do
  @moduledoc "Line-delimited JSON transport for extension-owned BEAM sessions."

  alias Pi.MCP.Tools
  alias Pi.Plugin.Event
  alias Pi.Skill.Loader

  def start do
    :persistent_term.put({__MODULE__, :pid}, self())
    Event.install()
    ready()

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
    with {:ok, %{"type" => "call", "id" => id, "name" => name} = request} <- Jason.decode(line) do
      args = Map.get(request, "arguments", %{})
      respond(id, dispatch(name, args))
    end
  rescue
    _ -> :ok
  end

  defp dispatch("pi_skills_list", _args) do
    {:ok, Jason.encode!(Loader.serializable())}
  end

  defp dispatch("pi_event", args) do
    Event.push(args)
    {:ok, "ok"}
  end

  defp dispatch(name, args), do: Tools.dispatch(name, args)

  defp respond(id, {:ok, text}) do
    write(%{type: :result, id: id, text: text, isError: false})
  end

  defp respond(id, {:error, message}) do
    write(%{type: :result, id: id, text: message, isError: true})
  end

  defp ready, do: write(%{type: :ready})

  defp write(payload) do
    IO.write([Jason.encode!(payload), ?\n])
  end
end
