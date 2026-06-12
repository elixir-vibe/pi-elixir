defmodule Pi.Bridge.InfoTest do
  use ExUnit.Case, async: false

  alias Pi.Bridge.Info
  alias Pi.Protocol.BridgeInfo
  alias Pi.Protocol.Ready
  alias Pi.Transport.Stdio

  test "snapshot returns a strict protocol struct" do
    version = Application.spec(:pi_bridge, :vsn) |> to_string()

    assert %BridgeInfo{project: :pi_bridge, version: ^version, transport: :stdio} =
             Info.snapshot(:stdio)
  end

  test "ready event encodes bridge info at the transport boundary" do
    version = Application.spec(:pi_bridge, :vsn) |> to_string()
    ready = %Ready{type: :ready, info: Info.snapshot(:stdio)}
    encoded = Jason.encode!(Stdio.__test_payload__(ready))

    assert %{"type" => "ready", "info" => %{"project" => "pi_bridge", "version" => ^version}} =
             Jason.decode!(encoded)
  end

  test "runtime inventory and eval prelude expose host helpers separately from sessions" do
    runtime_modules = Enum.map(Info.runtime_apis(), & &1.module)

    assert Pi.Host in runtime_modules
    assert Pi.Session in runtime_modules
    assert Info.aliases_code() =~ "alias Pi.Host, as: Host"
  end
end
