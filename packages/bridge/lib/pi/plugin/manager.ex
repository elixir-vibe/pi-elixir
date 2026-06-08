defmodule Pi.Plugin.Manager do
  @moduledoc "Discovers and runs project-local pi_bridge plugins."

  use GenServer

  alias Pi.Plugin.API
  alias Pi.Protocol.PluginInfo

  def start_link(opts \\ []), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  def install do
    case Process.whereis(__MODULE__) do
      nil -> start_link([])
      _pid -> :ok
    end
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

  @impl true
  def init(_opts) do
    plugins = discover()

    states = Map.new(plugins, &{&1, init_plugin(&1)})

    {:ok, %{plugins: plugins, states: states}}
  end

  @impl true
  def handle_cast({:event, event}, state) do
    states =
      Map.new(state.plugins, fn module ->
        plugin_state = Map.get(state.states, module, %{})
        {module, handle_plugin_event(module, event, plugin_state)}
      end)

    {:noreply, %{state | states: states}}
  end

  @impl true
  def handle_call(:plugins, _from, state) do
    plugins = Enum.map(state.plugins, &%PluginInfo{module: &1, name: module_name(&1)})
    {:reply, plugins, state}
  end

  def handle_call(:apis, _from, state) do
    apis =
      state.plugins
      |> Enum.flat_map(&plugin_apis/1)
      |> Enum.uniq_by(&{&1.alias, &1.module})

    {:reply, apis, state}
  end

  defp init_plugin(module) do
    if function_exported?(module, :init, 1) do
      normalize_init(module.init([]))
    else
      %{}
    end
  end

  defp normalize_init({:ok, state}), do: state
  defp normalize_init({:error, _reason}), do: %{}
  defp normalize_init(state), do: state

  defp handle_plugin_event(module, event, state) do
    if function_exported?(module, :handle_event, 2) do
      case module.handle_event(event, state) do
        {:noreply, next_state} -> next_state
        next_state -> next_state
      end
    else
      state
    end
  rescue
    _ -> state
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
    _ -> []
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

  defp plugin_apis(module) do
    if function_exported?(module, :apis, 0) do
      Enum.map(module.apis(), &API.new/1)
    else
      []
    end
  end

  defp module_name(module), do: module |> Module.split() |> List.last()
end
