defmodule PiDemoProject.DemoPlugin do
  use Pi.Plugin

  def init(_opts), do: {:ok, %{events: 0}}

  def handle_event(_event, state), do: {:noreply, Map.update(state, :events, 1, &(&1 + 1))}

  command(name: :demo_plugin_status, description: "Report demo plugin status")

  def handle_command(:demo_plugin_status, args, state) do
    Pi.Plugin.Event.emit("pi-elixir:demo", %{args: args, events: state.events})
    {{:ok, "demo plugin events=#{state.events} args=#{args}"}, state}
  end

  def tool_call(%{"toolName" => "demo_blocked"}, _context, state), do: {{:block, "blocked by demo plugin"}, state}
  def tool_call(%{"toolName" => "demo_patch_call"}, _context, state), do: {{:ok, %{"patched" => true}}, state}
  def tool_call(_call, _context, state), do: {:ok, state}

  def tool_result(%{"toolName" => "demo_patch_result"}, _context, state) do
    {{:ok, %{"content" => "patched by demo plugin"}}, state}
  end

  def tool_result(_result, _context, state), do: {:ok, state}

  def apis do
    [
      name: :demo_fixture_plugin,
      module: __MODULE__,
      alias: :DemoFixturePlugin,
      description: "Demo plugin API exposed by the fixture project"
    ]
  end
end
