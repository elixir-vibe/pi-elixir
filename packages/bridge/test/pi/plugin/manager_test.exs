defmodule Pi.Plugin.ManagerTest do
  use ExUnit.Case, async: false

  alias Pi.Plugin.Manager

  defmodule Demo do
    use Pi.Plugin

    def apis do
      [name: :manager_demo, module: __MODULE__, alias: :ManagerDemo]
    end
  end

  setup do
    if pid = Process.whereis(Manager), do: GenServer.stop(pid)
    if pid = Process.whereis(Pi.Plugin.Supervisor), do: DynamicSupervisor.stop(pid)
    :ok
  end

  test "supervises plugin workers without centralizing plugin state" do
    {:ok, _pid} = Manager.start_link(plugins: [Demo])

    assert [%Pi.Protocol.PluginInfo{module: Demo, name: "Demo"}] = Manager.plugins()

    assert [%Pi.Plugin.API{name: :manager_demo, module: Demo, alias: :ManagerDemo}] =
             Manager.apis()
  end

  test "restarts a plugin worker after process exit" do
    {:ok, pid} = Manager.start_link(plugins: [Demo])
    first_worker = pid |> :sys.get_state() |> Map.fetch!(:children) |> Map.fetch!(Demo)

    Process.exit(first_worker, :kill)

    assert eventually(fn ->
             next_worker = pid |> :sys.get_state() |> Map.fetch!(:children) |> Map.fetch!(Demo)
             next_worker != first_worker and Process.alive?(next_worker)
           end)
  end

  defp eventually(fun, attempts \\ 20)

  defp eventually(fun, attempts) when attempts > 0 do
    if fun.() do
      true
    else
      Process.sleep(25)
      eventually(fun, attempts - 1)
    end
  end

  defp eventually(_fun, 0), do: false
end
