defmodule Pi.Plugin.Manager do
  @moduledoc "Discovers and runs project-local pi_bridge plugins."

  use GenServer

  alias Pi.Plugin.Worker
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
    children =
      discover()
      |> Enum.map(&start_plugin/1)
      |> Enum.reject(&is_nil/1)

    {:ok, %{children: children}}
  end

  @impl true
  def handle_cast({:event, event}, state) do
    Enum.each(state.children, fn {_module, pid} -> Worker.dispatch_event(pid, event) end)
    {:noreply, state}
  end

  @impl true
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

  defp start_plugin(module) do
    case Worker.start_link(module) do
      {:ok, pid} -> {module, pid}
      {:error, _reason} -> nil
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
