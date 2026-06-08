defmodule Pi.Plugin.SupervisorTest do
  use ExUnit.Case, async: false

  alias Pi.Plugin.Supervisor, as: PluginSupervisor

  defmodule Demo do
    use Pi.Plugin
  end

  setup do
    if pid = Process.whereis(PluginSupervisor), do: DynamicSupervisor.stop(pid)
    :ok
  end

  test "starts plugin workers under a DynamicSupervisor" do
    {:ok, _supervisor} = PluginSupervisor.install()
    {:ok, worker} = PluginSupervisor.start_plugin(Demo)

    assert Process.alive?(worker)

    assert [{_, ^worker, :worker, [Pi.Plugin.Worker]}] =
             DynamicSupervisor.which_children(PluginSupervisor)
  end
end
