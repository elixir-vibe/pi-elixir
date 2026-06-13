defmodule Pi.IntegrationsTest do
  use ExUnit.Case, async: true

  alias Pi.Integrations.ExUnit, as: ExUnitIntegration
  alias Pi.Integrations.PhoenixReplay
  alias Pi.Integrations.Volt
  alias Pi.Protocol.Integration.Status

  test "built-in integration statuses use protocol structs" do
    assert [%Status{key: :ex_unit, text: "test env"}] = ExUnitIntegration.statuses()
  end

  test "webdev integrations are quiet when packages are unavailable" do
    assert Volt.name() == :volt
    assert PhoenixReplay.name() == :phoenix_replay
    assert Volt.statuses() == []
    assert PhoenixReplay.statuses() == []
  end
end
