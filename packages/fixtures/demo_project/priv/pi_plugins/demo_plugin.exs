defmodule PiDemoProject.DemoPlugin do
  use Pi.Plugin

  def init(_opts), do: {:ok, %{events: 0}}

  def handle_event(_event, state), do: {:noreply, Map.update(state, :events, 1, &(&1 + 1))}

  def apis do
    [
      name: :demo_fixture_plugin,
      module: __MODULE__,
      alias: :DemoFixturePlugin,
      description: "Demo plugin API exposed by the fixture project"
    ]
  end
end
