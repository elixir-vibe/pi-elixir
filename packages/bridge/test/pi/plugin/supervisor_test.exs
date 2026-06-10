defmodule Pi.Plugin.SupervisorTest do
  use ExUnit.Case, async: false

  alias Pi.Plugin.Supervisor, as: PluginSupervisor

  defmodule Demo do
    use Pi.Plugin
  end

  setup do
    if pid = Process.whereis(PluginSupervisor), do: stop_if_alive(pid)
    :ok
  end

  test "starts plugin workers under a DynamicSupervisor" do
    assert {:ok, _supervisor} = install_supervisor()
    {:ok, worker} = PluginSupervisor.start_plugin(Demo)

    assert Process.alive?(worker)

    assert Enum.any?(DynamicSupervisor.which_children(PluginSupervisor), fn
             {_, ^worker, :worker, [Pi.Plugin.Worker]} -> true
             _child -> false
           end)
  end

  defp install_supervisor do
    case PluginSupervisor.install() do
      {:ok, pid} -> {:ok, pid}
      {:error, {:already_started, pid}} -> {:ok, pid}
    end
  end

  defp stop_if_alive(pid) do
    if Process.alive?(pid), do: DynamicSupervisor.stop(pid)
  catch
    :exit, _reason -> :ok
  end
end
