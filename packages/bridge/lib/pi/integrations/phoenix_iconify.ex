defmodule Pi.Integrations.PhoenixIconify do
  @moduledoc "PhoenixIconify-specific project status discovery."

  @behaviour Pi.Integration

  def name, do: :phoenix_iconify

  def statuses, do: []
end
