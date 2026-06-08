defmodule Pi.IntegrationsTest do
  use ExUnit.Case, async: true

  alias Pi.Integrations.ExUnit, as: ExUnitIntegration
  alias Pi.Protocol.Integration.Status
  alias Pi.Protocol.UIEvent
  alias Pi.Transport.Stdio

  test "built-in integration statuses use protocol structs" do
    assert [%Status{key: :ex_unit, text: "test env"}] = ExUnitIntegration.statuses()
  end

  test "integration status encodes as a UI status payload" do
    status = %Status{key: :ecto, text: "ecto 1/1"}
    event = %UIEvent{type: :ui, op: :status, key: status.key, text: status.text}
    payload = Stdio.__test_payload__(event)

    assert Map.take(payload, ["type", "op", "key", "text"]) == %{
             "type" => "ui",
             "op" => "status",
             "key" => "ecto",
             "text" => "ecto 1/1"
           }
  end
end
