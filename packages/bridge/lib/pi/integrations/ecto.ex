if Code.ensure_loaded?(Ecto.Repo) do
  defmodule Pi.Integrations.Ecto do
    @moduledoc "Ecto-specific project status discovery."

    @behaviour Pi.Integration

    alias Pi.Protocol.Integration.Status

    def name, do: :ecto

    def repos do
      for {app, _, _} <- Application.started_applications(),
          repo <- Application.get_env(app, :ecto_repos, []) do
        %{module: inspect(repo), app: app, running: running?(repo)}
      end
    end

    def statuses do
      case repos() do
        [] ->
          []

        repos ->
          [%Status{key: :ecto, text: "ecto #{Enum.count(repos, & &1.running)}/#{length(repos)}"}]
      end
    end

    defp running?(repo), do: Process.whereis(repo) != nil
  end
end
