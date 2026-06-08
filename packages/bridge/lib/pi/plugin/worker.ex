defmodule Pi.Plugin.Worker do
  @moduledoc "Isolated GenServer wrapper for one project-local pi_bridge plugin."

  use GenServer

  alias Pi.Plugin.API
  alias Pi.Plugin.Command

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

  def commands(pid) when is_pid(pid), do: GenServer.call(pid, :commands)

  def run_command(pid, name, args) when is_pid(pid) and is_atom(name) and is_binary(args) do
    GenServer.call(pid, {:command, name, args})
  end

  def tool_call(pid, call, context) when is_pid(pid) and is_map(call) and is_map(context) do
    GenServer.call(pid, {:tool_call, call, context})
  end

  def tool_result(pid, result, context) when is_pid(pid) and is_map(result) and is_map(context) do
    GenServer.call(pid, {:tool_result, result, context})
  end

  def info(pid) when is_pid(pid), do: GenServer.call(pid, :info)

  def shutdown(pid) when is_pid(pid), do: GenServer.call(pid, :shutdown)

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

  def handle_call(:commands, _from, %__MODULE__{module: module} = plugin) do
    {:reply, plugin_commands(module), plugin}
  end

  def handle_call(
        {:command, name, args},
        _from,
        %__MODULE__{module: module, state: state} = plugin
      ) do
    {reply, next_state} = handle_plugin_command(module, name, args, state)
    {:reply, reply, %{plugin | state: next_state}}
  end

  def handle_call(
        {:tool_call, call, context},
        _from,
        %__MODULE__{module: module, state: state} = plugin
      ) do
    {reply, next_state} = handle_plugin_tool_call(module, call, context, state)
    {:reply, reply, %{plugin | state: next_state}}
  end

  def handle_call(
        {:tool_result, result, context},
        _from,
        %__MODULE__{module: module, state: state} = plugin
      ) do
    {reply, next_state} = handle_plugin_tool_result(module, result, context, state)
    {:reply, reply, %{plugin | state: next_state}}
  end

  def handle_call(:info, _from, %__MODULE__{module: module} = plugin) do
    {:reply, {module, module_name(module)}, plugin}
  end

  def handle_call(:shutdown, _from, %__MODULE__{module: module, state: state} = plugin) do
    {:reply, shutdown_plugin(module, state), plugin}
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

  defp shutdown_plugin(module, state) do
    if function_exported?(module, :shutdown, 1) do
      module.shutdown(state)
    else
      :ok
    end
  rescue
    _exception in [ArgumentError, FunctionClauseError, KeyError, MatchError, RuntimeError] -> :ok
  end

  defp handle_plugin_command(module, name, args, state) do
    if function_exported?(module, :handle_command, 3) do
      normalize_stateful_result(module.handle_command(name, args, state), state)
    else
      {{:error, "Unknown plugin command"}, state}
    end
  rescue
    exception in [ArgumentError, FunctionClauseError, KeyError, MatchError, RuntimeError] ->
      {{:error, Exception.message(exception)}, state}
  end

  defp handle_plugin_tool_call(module, call, context, state) do
    if function_exported?(module, :tool_call, 3) do
      normalize_stateful_result(module.tool_call(call, context, state), state)
    else
      {:ok, state}
    end
  rescue
    exception in [ArgumentError, FunctionClauseError, KeyError, MatchError, RuntimeError] ->
      {{:block, Exception.message(exception)}, state}
  end

  defp handle_plugin_tool_result(module, result, context, state) do
    if function_exported?(module, :tool_result, 3) do
      normalize_stateful_result(module.tool_result(result, context, state), state)
    else
      {:ok, state}
    end
  rescue
    _exception in [ArgumentError, FunctionClauseError, KeyError, MatchError, RuntimeError] ->
      {:ok, state}
  end

  defp normalize_stateful_result({reply, next_state}, _state), do: {reply, next_state}
  defp normalize_stateful_result(reply, state), do: {reply, state}

  defp plugin_apis(module) do
    if function_exported?(module, :apis, 0) do
      module.apis()
      |> List.wrap()
      |> normalize_apis()
    else
      []
    end
  end

  defp plugin_commands(module) do
    if function_exported?(module, :commands, 0) do
      module.commands()
      |> List.wrap()
      |> normalize_commands(module)
    else
      []
    end
  end

  defp normalize_apis([{key, _value} | _rest] = api) when is_atom(key), do: [API.new(api)]
  defp normalize_apis(apis), do: Enum.map(apis, &API.new/1)

  defp normalize_commands([{key, _value} | _rest] = command, module) when is_atom(key) do
    [command |> Map.new() |> Map.put_new(:plugin, module) |> Command.new()]
  end

  defp normalize_commands(commands, module) do
    Enum.map(commands, fn command ->
      command
      |> Command.new()
      |> Map.update!(:plugin, &(&1 || module))
    end)
  end

  defp module_name(module), do: module |> Module.split() |> List.last()
end
