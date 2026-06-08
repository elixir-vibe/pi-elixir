defmodule Pi.Plugin.Manager do
  @moduledoc "Discovers and runs project-local pi_bridge plugins."

  use GenServer

  alias Pi.Plugin.Supervisor, as: PluginSupervisor
  alias Pi.Plugin.Worker
  alias Pi.Protocol.PluginInfo

  defstruct children: %{}, monitors: %{}, refs: %{}

  def start_link(opts \\ []), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  def install do
    case Process.whereis(__MODULE__) do
      nil -> start_link([])
      _pid -> :ok
    end
  end

  def load(module, opts \\ []) when is_atom(module) do
    install()
    GenServer.call(__MODULE__, {:load, module, opts})
  end

  def unload(module) when is_atom(module) do
    install()
    GenServer.call(__MODULE__, {:unload, module})
  end

  def dispatch_event(event) when is_map(event) do
    install()
    GenServer.cast(__MODULE__, {:event, event})
  end

  def plugins do
    install()
    GenServer.call(__MODULE__, :plugins)
  end

  def apis do
    install()
    GenServer.call(__MODULE__, :apis)
  end

  def commands do
    install()
    GenServer.call(__MODULE__, :commands)
  end

  def run_command(name, args) when is_atom(name) and is_binary(args) do
    install()
    GenServer.call(__MODULE__, {:command, name, args})
  end

  def tool_call(call, context \\ %{}) when is_map(call) and is_map(context) do
    install()
    GenServer.call(__MODULE__, {:tool_call, call, context})
  end

  def tool_result(result, context \\ %{}) when is_map(result) and is_map(context) do
    install()
    GenServer.call(__MODULE__, {:tool_result, result, context})
  end

  @impl true
  def init(opts) do
    PluginSupervisor.install()
    modules = Keyword.get_lazy(opts, :plugins, &discover/0)
    {:ok, Enum.reduce(modules, %__MODULE__{}, &put_started_plugin(&2, &1))}
  end

  @impl true
  def handle_cast({:event, event}, state) do
    Enum.each(state.children, fn {_module, pid} -> Worker.dispatch_event(pid, event) end)
    {:noreply, state}
  end

  @impl true
  def handle_call({:load, module, _opts}, _from, state) do
    if Map.has_key?(state.children, module) do
      {:reply, {:error, :already_loaded}, state}
    else
      case PluginSupervisor.start_plugin(module) do
        {:ok, pid} -> {:reply, :ok, put_plugin(state, module, pid)}
        {:error, reason} -> {:reply, {:error, reason}, state}
      end
    end
  end

  def handle_call({:unload, module}, _from, state) do
    {:reply, :ok, unload_plugin(state, module)}
  end

  def handle_call(:plugins, _from, state) do
    plugins =
      Enum.map(state.children, fn {module, pid} ->
        case Worker.info(pid) do
          {^module, name} -> %PluginInfo{module: module, name: name}
        end
      end)

    {:reply, plugins, state}
  end

  def handle_call(:apis, _from, state) do
    apis =
      state.children
      |> Enum.flat_map(fn {_module, pid} -> Worker.apis(pid) end)
      |> Enum.uniq_by(&{&1.alias, &1.module})

    {:reply, apis, state}
  end

  def handle_call(:commands, _from, state) do
    commands =
      state.children
      |> Enum.flat_map(fn {_module, pid} -> Worker.commands(pid) end)
      |> Enum.uniq_by(& &1.name)

    {:reply, commands, state}
  end

  def handle_call({:command, name, args}, _from, state) do
    reply =
      state.children
      |> Enum.find_value({:error, "Unknown plugin command: #{name}"}, fn {_module, pid} ->
        if Enum.any?(Worker.commands(pid), &(&1.name == name)) do
          Worker.run_command(pid, name, args)
        end
      end)

    {:reply, reply, state}
  end

  def handle_call({:tool_call, call, context}, _from, state) do
    {:reply, run_tool_call_pipeline(state, call, context), state}
  end

  def handle_call({:tool_result, result, context}, _from, state) do
    {:reply, run_tool_result_pipeline(state, result, context), state}
  end

  @impl true
  def handle_info({:DOWN, ref, :process, _pid, _reason}, state) do
    case Map.pop(state.monitors, ref) do
      {nil, monitors} ->
        {:noreply, %{state | monitors: monitors}}

      {module, monitors} ->
        state = %{
          state
          | children: Map.delete(state.children, module),
            monitors: monitors,
            refs: Map.delete(state.refs, module)
        }

        {:noreply, put_started_plugin(state, module)}
    end
  end

  defp run_tool_call_pipeline(state, call, context) do
    Enum.reduce_while(state.children, {:ok, call}, fn {_module, pid}, {:ok, current_call} ->
      case Worker.tool_call(pid, current_call, context) do
        {:block, reason} -> {:halt, {:block, reason}}
        {:ok, patch} when is_map(patch) -> {:cont, {:ok, Map.merge(current_call, patch)}}
        :ok -> {:cont, {:ok, current_call}}
        _other -> {:cont, {:ok, current_call}}
      end
    end)
  end

  defp run_tool_result_pipeline(state, result, context) do
    Enum.reduce(state.children, {:ok, result}, fn {_module, pid}, {:ok, current_result} ->
      case Worker.tool_result(pid, current_result, context) do
        {:ok, patch} when is_map(patch) -> {:ok, Map.merge(current_result, patch)}
        :ok -> {:ok, current_result}
        _other -> {:ok, current_result}
      end
    end)
  end

  defp put_started_plugin(state, module) do
    case PluginSupervisor.start_plugin(module) do
      {:ok, pid} -> put_plugin(state, module, pid)
      {:error, _reason} -> state
    end
  end

  defp put_plugin(state, module, pid) do
    ref = Process.monitor(pid)

    %{
      state
      | children: Map.put(state.children, module, pid),
        monitors: Map.put(state.monitors, ref, module),
        refs: Map.put(state.refs, module, ref)
    }
  end

  defp unload_plugin(state, module) do
    case Map.pop(state.children, module) do
      {nil, _children} ->
        state

      {pid, children} ->
        Worker.shutdown(pid)
        PluginSupervisor.stop_plugin(pid)
        state = demonitor_plugin(state, module)
        %{state | children: children}
    end
  end

  defp demonitor_plugin(state, module) do
    case Map.pop(state.refs, module) do
      {nil, refs} ->
        %{state | refs: refs}

      {ref, refs} ->
        Process.demonitor(ref, [:flush])
        %{state | refs: refs, monitors: Map.delete(state.monitors, ref)}
    end
  end

  defp discover do
    default_paths()
    |> Enum.flat_map(&files/1)
    |> Enum.flat_map(&load_file/1)
    |> Enum.uniq()
  end

  defp load_file(path) do
    path
    |> Code.compile_file()
    |> Enum.map(&elem(&1, 0))
    |> Enum.filter(&plugin_module?/1)
  rescue
    _exception in [ArgumentError, Code.LoadError, CompileError, File.Error, SyntaxError] -> []
  end

  defp plugin_module?(module) do
    Code.ensure_loaded?(module) and Pi.Plugin in behaviours(module)
  end

  defp behaviours(module), do: module.module_info(:attributes) |> Keyword.get(:behaviour, [])

  defp default_paths do
    [
      Path.join(File.cwd!(), "priv/pi_plugins"),
      Path.join(File.cwd!(), ".pi/plugins"),
      Path.join(File.cwd!(), "pi_plugins")
    ]
  end

  defp files(dir) do
    dir = Path.expand(dir)

    [Path.join(dir, "**/*.exs"), Path.join(dir, "**/*.ex")]
    |> Enum.flat_map(&Path.wildcard/1)
    |> Enum.uniq()
  end
end
