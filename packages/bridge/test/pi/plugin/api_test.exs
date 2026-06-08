defmodule Pi.Plugin.APITest do
  use ExUnit.Case, async: true

  alias Pi.Plugin.API

  test "normalizes keyword and map API metadata" do
    assert %API{name: :demo, module: __MODULE__, alias: :APITest} =
             API.new(name: :demo, module: __MODULE__)

    assert %API{name: :map_demo, module: __MODULE__, alias: :CustomAlias} =
             API.new(%{name: :map_demo, module: __MODULE__, alias: :CustomAlias})
  end
end
