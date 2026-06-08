defmodule Pi.Plugin.Worker do
  @moduledoc "Isolated GenServer wrapper for one project-local pi_bridge plugin."

  use GenServer

  alias Pi.Plugin.API

  @enforce_keys [:module]
  defstruct [:module, state: %{}]

  @type t :: %__MODULE__{module: module(), state: term()}

  def child_spec(module) when is_atom(module) do
    %{
      id: {__MODULE__, module},
      start: {__MODULE__, :start_link, [module]},
      restart: :temporary,
      type: :worker
    }
  end

  def start_link(module) when is_atom(module) do
    GenServer.start_link(__MODULE__, module)
  end

  def dispatch_event(pid, event) when is_pid(pid) and is_map(event) do
    GenServer.cast(pid, {:event, event})
  end

  def apis(pid) when is_pid(pid), do: GenServer.call(pid, :apis)

  def info(pid) when is_pid(pid), do: GenServer.call(pid, :info)

  @impl true
  def init(module), do: {:ok, %__MODULE__{module: module, state: init_plugin(module)}}

  @impl true
  def handle_cast({:event, event}, %__MODULE__{module: module, state: state} = plugin) do
    {:noreply, %{plugin | state: handle_plugin_event(module, event, state)}}
  end

  @impl true
  def handle_call(:apis, _from, %__MODULE__{module: module} = plugin) do
    {:reply, plugin_apis(module), plugin}
  end

  def handle_call(:info, _from, %__MODULE__{module: module} = plugin) do
    {:reply, {module, module_name(module)}, plugin}
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
    _exception in [ArgumentError, FunctionClauseError, KeyError, MatchError, RuntimeError] ->
      state
  end

  defp plugin_apis(module) do
    if function_exported?(module, :apis, 0) do
      module.apis()
      |> List.wrap()
      |> normalize_apis()
    else
      []
    end
  end

  defp normalize_apis([{key, _value} | _rest] = api) when is_atom(key), do: [API.new(api)]
  defp normalize_apis(apis), do: Enum.map(apis, &API.new/1)

  defp module_name(module), do: module |> Module.split() |> List.last()
end
