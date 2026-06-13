defmodule Pi.Integrations.PhoenixIconify do
  @moduledoc "PhoenixIconify-specific project status discovery."

  @behaviour Pi.Integration

  alias Pi.Integrations.AppVersion
  alias Pi.Protocol.Integration.Status

  def name, do: :phoenix_iconify

  def statuses do
    case AppVersion.fetch(:phoenix_iconify) do
      {:ok, version} -> [%Status{key: :phoenix_iconify, text: "icons #{version}"}]
      :error -> []
    end
  end
end
