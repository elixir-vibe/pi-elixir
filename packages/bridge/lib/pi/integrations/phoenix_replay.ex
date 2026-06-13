defmodule Pi.Integrations.PhoenixReplay do
  @moduledoc "PhoenixReplay-specific project status discovery."

  @behaviour Pi.Integration

  alias Pi.Integrations.AppVersion
  alias Pi.Protocol.Integration.Status

  def name, do: :phoenix_replay

  def statuses do
    case AppVersion.fetch(:phoenix_replay) do
      {:ok, version} -> [%Status{key: :phoenix_replay, text: "replay #{version}"}]
      :error -> []
    end
  end
end
