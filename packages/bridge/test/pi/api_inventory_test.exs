defmodule Pi.APIInventoryTest do
  use ExUnit.Case, async: false

  alias Pi.Bridge.Info
  alias Pi.Plugin.API
  alias Pi.Protocol.APIInventory
  alias Pi.Protocol.BridgeInfo
  alias Pi.Protocol.ExtensionAPI
  alias Pi.Protocol.SkillInfo
  alias Pi.Transport.Stdio

  test "extension APIs use protocol structs" do
    api = API.new(name: :demo, module: __MODULE__, alias: :Demo, description: "demo")

    assert %ExtensionAPI{name: :demo, module: __MODULE__, alias: :Demo, description: "demo"} =
             ExtensionAPI.from_api(api)
  end

  test "bridge snapshot carries structured API inventory" do
    assert %BridgeInfo{apis: %APIInventory{runtime: runtime, extensions: extensions}} =
             Info.snapshot(:stdio)

    assert is_list(runtime)
    assert is_list(extensions)
  end

  test "skill info encodes metadata and extension APIs at the transport boundary" do
    skill = %SkillInfo{
      name: "demo",
      path: "/tmp/demo.skill.exs",
      module: __MODULE__,
      metadata: %{"name" => "demo"},
      markdown: "# Demo",
      apis: [%ExtensionAPI{name: :demo, module: __MODULE__, alias: :Demo}]
    }

    payload = Stdio.__test_payload__(skill)

    assert payload["module"] == Atom.to_string(__MODULE__)
    assert [%{"name" => "demo", "alias" => "Demo"}] = payload["apis"]
  end
end
