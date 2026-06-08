defmodule Pi.Plugin.APITest do
  use ExUnit.Case, async: true

  alias Pi.Plugin.API

  test "normalizes keyword and map API metadata" do
    assert %API{name: :demo, module: __MODULE__, alias: :Demo} =
             API.new(name: :demo, module: __MODULE__, alias: :Demo)

    assert %API{name: :map_demo, module: __MODULE__} =
             API.new(%{name: :map_demo, module: __MODULE__})
  end
end
