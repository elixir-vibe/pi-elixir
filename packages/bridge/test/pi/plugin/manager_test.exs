defmodule Pi.Plugin.ManagerTest do
  use ExUnit.Case, async: false

  alias Pi.Plugin.Manager

  defmodule Demo do
    use Pi.Plugin

    def apis do
      [name: :manager_demo, module: __MODULE__, alias: :ManagerDemo]
    end
  end

  defmodule MacroDemo do
    use Pi.Plugin

    api(name: :macro_manager_demo, module: __MODULE__)
    command(name: :macro_command, description: "Run macro command")

    def handle_command(:macro_command, args, state), do: {{:ok, "ran #{args}"}, state}
  end

  defmodule HookDemo do
    use Pi.Plugin

    def tool_call(%{"input" => _input}, _context, state) do
      {{:ok, %{"patched" => true}}, state}
    end

    def tool_result(_result, _context, state),
      do: {{:ok, %{"content" => "patched result"}}, state}
  end

  setup do
    if pid = Process.whereis(Manager), do: stop_if_alive(pid, &GenServer.stop/1)

    if pid = Process.whereis(Pi.Plugin.Supervisor),
      do: stop_if_alive(pid, &DynamicSupervisor.stop/1)

    :ok
  end

  test "supervises plugin workers without centralizing plugin state" do
    {:ok, _pid} = Manager.start_link(plugins: [Demo])

    assert [%Pi.Protocol.PluginInfo{module: Demo, name: "Demo"}] = Manager.plugins()

    assert [%Pi.Plugin.API{name: :manager_demo, module: Demo, alias: :ManagerDemo}] =
             Manager.apis()
  end

  test "loads and unloads plugins dynamically" do
    {:ok, _pid} = Manager.start_link(plugins: [])

    assert :ok = Manager.load(MacroDemo)
    assert {:error, :already_loaded} = Manager.load(MacroDemo)
    assert [%Pi.Protocol.PluginInfo{module: MacroDemo, name: "MacroDemo"}] = Manager.plugins()

    assert [%Pi.Plugin.API{name: :macro_manager_demo, module: MacroDemo, alias: :MacroDemo}] =
             Manager.apis()

    assert [%Pi.Plugin.Command{name: :macro_command, plugin: MacroDemo}] = Manager.commands()
    assert {:ok, "ran args"} = Manager.run_command(:macro_command, "args")

    assert :ok = Manager.unload(MacroDemo)
    assert [] = Manager.plugins()
  end

  test "runs plugin tool hook pipelines" do
    {:ok, _pid} = Manager.start_link(plugins: [HookDemo])

    assert {:ok, %{"patched" => true}} = Manager.tool_call(%{"input" => %{}}, %{})

    assert {:ok, %{"content" => "patched result"}} = Manager.tool_result(%{}, %{})
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

  defp stop_if_alive(pid, stop) do
    if Process.alive?(pid), do: stop.(pid)
  catch
    :exit, _reason -> :ok
  end
end
