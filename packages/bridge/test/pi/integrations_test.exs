defmodule Pi.IntegrationsTest do
  use ExUnit.Case, async: true

  alias Pi.Integrations.ExUnit, as: ExUnitIntegration
  alias Pi.Protocol.Integration.Status

  test "built-in integration statuses use protocol structs" do
    assert [%Status{key: :ex_unit, text: "test env"}] = ExUnitIntegration.statuses()
  end
end
