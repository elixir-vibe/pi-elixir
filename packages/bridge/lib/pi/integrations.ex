defmodule Pi.Integrations do
  @moduledoc "Optional project integration discovery."

  @integrations [
    phoenix: Pi.Integrations.Phoenix,
    ecto: Pi.Integrations.Ecto,
    oban: Pi.Integrations.Oban,
    ex_unit: Pi.Integrations.ExUnit
  ]

  def loaded do
    @integrations
    |> Enum.filter(fn {_name, module} -> Code.ensure_loaded?(module) end)
    |> Enum.map(&elem(&1, 0))
  end

  def endpoints, do: optional(Pi.Integrations.Phoenix, :endpoints)

  def statuses do
    @integrations
    |> Enum.flat_map(fn {_name, module} -> optional(module, :statuses) end)
    |> Enum.uniq_by(& &1.key)
  end

  defp optional(module, function) do
    if Code.ensure_loaded?(module) and function_exported?(module, function, 0) do
      apply(module, function, [])
    else
      []
    end
  end
end
