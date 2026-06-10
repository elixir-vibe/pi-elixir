defmodule Pi.Bridge.InfoTest do
  use ExUnit.Case, async: false

  alias Pi.Bridge.Info
  alias Pi.Protocol.BridgeInfo
  alias Pi.Protocol.Ready
  alias Pi.Transport.Stdio

  test "snapshot returns a strict protocol struct" do
    assert %BridgeInfo{project: :pi_bridge, version: "0.6.5", transport: :stdio} =
             Info.snapshot(:stdio)
  end

  test "ready event encodes bridge info at the transport boundary" do
    ready = %Ready{type: :ready, info: Info.snapshot(:stdio)}
    encoded = Jason.encode!(Stdio.__test_payload__(ready))

    assert %{"type" => "ready", "info" => %{"project" => "pi_bridge", "version" => "0.6.5"}} =
             Jason.decode!(encoded)
  end
end
