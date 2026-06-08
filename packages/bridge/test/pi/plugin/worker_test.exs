defmodule Pi.Plugin.WorkerTest do
  use ExUnit.Case, async: true

  alias Pi.Plugin.Worker

  defmodule Demo do
    use Pi.Plugin

    def init(_opts), do: {:ok, %{events: 0}}

    def handle_event(_event, state), do: {:noreply, Map.update!(state, :events, &(&1 + 1))}

    def apis do
      [name: :demo, module: __MODULE__, alias: :Demo]
    end
  end

  test "isolates plugin state in a worker process" do
    {:ok, pid} = Worker.start_link(Demo)

    Worker.dispatch_event(pid, %{type: "demo"})

    assert {Demo, "Demo"} = Worker.info(pid)
    assert [%Pi.Plugin.API{name: :demo, module: Demo, alias: :Demo}] = Worker.apis(pid)
  end
end
