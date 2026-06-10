defmodule Pi.DevTest do
  use ExUnit.Case, async: false

  alias Pi.Dev

  test "status returns compact runtime information" do
    status = Dev.status()

    assert status.app == :pi_bridge
    assert status.env in [:dev, :test]
    assert is_binary(status.bridge_version)
    assert is_integer(status.loaded_modules)
    assert status.restart_hint =~ "/elixir:restart"
  end

  test "loaded returns Pi modules by default" do
    modules = Dev.loaded()

    assert Pi.Dev in modules
    assert Enum.all?(modules, &(to_string(&1) =~ "Elixir.Pi"))
  end
end
