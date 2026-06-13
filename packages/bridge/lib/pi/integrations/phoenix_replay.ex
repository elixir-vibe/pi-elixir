defmodule Pi.Integrations.PhoenixReplay do
  @moduledoc "PhoenixReplay-specific project status discovery."

  @behaviour Pi.Integration

  alias Pi.Protocol.Integration.Status

  def name, do: :phoenix_replay

  def statuses do
    case app_version(:phoenix_replay) do
      {:ok, version} -> [%Status{key: :phoenix_replay, text: "replay #{version}"}]
      :error -> []
    end
  end

  defp app_version(app) do
    Application.load(app)

    case Application.spec(app, :vsn) do
      nil -> :error
      version -> {:ok, to_string(version)}
    end
  end
end
