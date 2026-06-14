defmodule Pi.Integrations.PhoenixReplay do
  @moduledoc "PhoenixReplay-specific project status discovery."

  @behaviour Pi.Integration

  def name, do: :phoenix_replay

  def statuses, do: []
end
