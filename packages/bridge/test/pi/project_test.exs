defmodule Pi.ProjectTest do
  use ExUnit.Case, async: true

  test "project metadata is compact and inspectable" do
    info = Pi.project()

    assert info.app == :pi_bridge
    assert is_binary(info.root)
    assert is_binary(info.elixir)
    assert is_binary(info.otp)
    assert is_list(info.deps)
    assert is_list(info.applications)
  end
end
