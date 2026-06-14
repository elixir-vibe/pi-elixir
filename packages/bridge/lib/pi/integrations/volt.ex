defmodule Pi.Integrations.Volt do
  @moduledoc "Volt-specific project status discovery."

  @behaviour Pi.Integration

  def name, do: :volt

  def statuses, do: []
end
