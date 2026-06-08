if Code.ensure_loaded?(ExUnit) do
  defmodule Pi.Integrations.ExUnit do
    @moduledoc "ExUnit status placeholder."

    @behaviour Pi.Integration

    alias Pi.Protocol.Integration.Status

    def name, do: :ex_unit

    def statuses do
      if Mix.env() == :test, do: [%Status{key: :ex_unit, text: "test env"}], else: []
    end
  end
end
