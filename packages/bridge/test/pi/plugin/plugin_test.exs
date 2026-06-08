defmodule Pi.PluginTest do
  use ExUnit.Case, async: true

  defmodule MacroPlugin do
    use Pi.Plugin

    api(name: :macro_plugin, module: __MODULE__, description: "macro api")
  end

  test "api macro registers plugin APIs with default aliases" do
    assert [%Pi.Plugin.API{name: :macro_plugin, module: MacroPlugin, alias: :MacroPlugin}] =
             MacroPlugin.apis()
  end
end
