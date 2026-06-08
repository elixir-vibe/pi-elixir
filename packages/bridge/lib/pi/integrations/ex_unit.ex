if Code.ensure_loaded?(ExUnit) do
  defmodule Pi.Integrations.ExUnit do
    @moduledoc "ExUnit status placeholder."

    @behaviour Pi.Integration

    def name, do: :ex_unit

    def statuses do
      if Mix.env() == :test, do: [%{key: :ex_unit, text: "test env"}], else: []
    rescue
      _ -> []
    end
  end
end
