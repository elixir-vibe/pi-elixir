defmodule DemoPiPlugin do
  use Pi.Plugin

  def init(_opts), do: {:ok, %{events: 0}}

  def handle_event(_event, state) do
    {:noreply, Map.update(state, :events, 1, &(&1 + 1))}
  end

  def apis do
    [
      name: :demo_plugin,
      module: __MODULE__,
      alias: :DemoPlugin,
      description: "Demo plugin API metadata exposed to pi"
    ]
  end
end
