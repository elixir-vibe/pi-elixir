defmodule Pi.Target.Attached do
  @moduledoc "Stateful eval attached to an explicitly configured distributed Erlang node."

  use GenServer

  alias Pi.Target.Result
  alias Pi.Target.Runtime.{Diagnostics, Evaluator, Snapshot, Term}

  @runtime_modules [Diagnostics, Term, Snapshot, Evaluator]
  @local_node_names ~w(
    pi_elixir_runtime_01 pi_elixir_runtime_02 pi_elixir_runtime_03 pi_elixir_runtime_04
    pi_elixir_runtime_05 pi_elixir_runtime_06 pi_elixir_runtime_07 pi_elixir_runtime_08
  )a
  @default_timeout 30_000

  def run(code, opts \\ []) when is_binary(code),
    do: code |> request(opts) |> Result.text()

  def run_structured(code, opts \\ []) when is_binary(code),
    do: code |> request(opts) |> Result.structured()

  def status(opts \\ []), do: call({:status, opts}, Keyword.get(opts, :timeout, @default_timeout))

  def request(code, opts \\ []) do
    timeout = Keyword.get(opts, :timeout, @default_timeout)
    call({:eval, code, opts}, timeout + 5_000)
  end

  @doc false
  def reset, do: call(:reset, 5_000)

  def start_link(_opts), do: GenServer.start_link(__MODULE__, %{}, name: __MODULE__)

  @impl true
  def init(state), do: {:ok, state}

  @impl true
  def handle_call({:status, opts}, _from, state) do
    case connect(opts) do
      {:ok, node} ->
        {:reply,
         %{
           connected: true,
           node: node,
           project_root: remote_call(node, File, :cwd!, [], 5_000),
           capabilities: [:attached_runtime, :stateful_eval, :structured_diagnostics]
         }, state}

      {:error, reason} ->
        {:reply, %{connected: false, error: reason}, state}
    end
  end

  def handle_call(:reset, _from, state) do
    Enum.each(state, fn {{node, _session_id}, evaluator} ->
      :erpc.cast(node, Process, :exit, [evaluator, :kill])
    end)

    {:reply, :ok, %{}}
  end

  def handle_call({:eval, code, opts}, _from, state) do
    session_id = Keyword.get(opts, :session_id, "default")
    timeout = Keyword.get(opts, :timeout, @default_timeout)

    with {:ok, node} <- connect(opts),
         :ok <- inject_runtime(node),
         {:ok, evaluator, state} <- evaluator(state, node, session_id, opts),
         {:ok, result} <- evaluate(node, evaluator, code, opts, timeout) do
      runtime = %{
        profile: "attached",
        node: node,
        os_pid: remote_call(node, System, :pid, [], 5_000)
      }

      {:reply, {:ok, Map.put(result, :runtime, runtime)}, state}
    else
      {:error, reason, state} -> {:reply, {:error, reason}, state}
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  defp call(message, timeout) do
    with :ok <- ensure_started() do
      GenServer.call(__MODULE__, message, timeout)
    end
  end

  defp ensure_started do
    if Process.whereis(__MODULE__), do: :ok, else: {:error, :attached_runtime_not_started}
  end

  defp connect(opts) do
    with {:ok, configured_node} <- configured_node(opts) do
      connect_node(configured_node, opts)
    end
  end

  defp connect_node(configured_node, opts) do
    with :ok <- ensure_distribution(opts),
         true <- Node.connect(configured_node) do
      {:ok, configured_node}
    else
      false -> {:error, %{kind: :node_unreachable, node: configured_node}}
      error -> error
    end
  end

  defp configured_node(opts) do
    value = Keyword.get(opts, :node) || System.get_env("PI_ELIXIR_NODE")

    cond do
      is_atom(value) and value not in [nil, :undefined, :nonode@nohost] ->
        {:ok, value}

      valid_node_name?(value) ->
        bounded_atom({__MODULE__, :configured_node}, value, 64)

      true ->
        {:error,
         %{kind: :node_not_configured, message: "Set PI_ELIXIR_NODE to an explicit node name"}}
    end
  end

  defp valid_node_name?(value) when is_binary(value) and byte_size(value) <= 255 do
    case String.split(value, "@", parts: 3) do
      [name, host] -> valid_node_part?(name) and valid_node_part?(host)
      _other -> false
    end
  end

  defp valid_node_name?(_value), do: false

  defp valid_node_part?(part) when byte_size(part) > 0 do
    part
    |> :binary.bin_to_list()
    |> Enum.all?(fn character ->
      character in ?A..?Z or character in ?a..?z or character in ?0..?9 or
        character in [?_, ?., ?-]
    end)
  end

  defp valid_node_part?(_part), do: false

  defp ensure_distribution(opts) do
    with :ok <- ensure_epmd(),
         :ok <- maybe_start_node(),
         do: configure_cookie(opts)
  end

  defp ensure_epmd do
    if Node.alive?() do
      :ok
    else
      System.find_executable("epmd")
      |> start_epmd()
    end
  end

  defp start_epmd(nil),
    do: {:error, %{kind: :epmd_unavailable, message: "epmd is not available on PATH"}}

  defp start_epmd(executable) do
    case System.cmd(executable, ["-daemon"], stderr_to_stdout: true) do
      {_output, 0} -> :ok
      {output, status} -> {:error, %{kind: :epmd_start_failed, status: status, output: output}}
    end
  end

  defp maybe_start_node do
    if Node.alive?() do
      :ok
    else
      name = Enum.at(@local_node_names, rem(System.unique_integer([:positive]), 8))

      case Node.start(name, name_domain: :shortnames) do
        {:ok, _pid} -> :ok
        {:error, {:already_started, _pid}} -> :ok
        {:error, reason} -> {:error, %{kind: :distribution_start_failed, reason: reason}}
      end
    end
  end

  defp configure_cookie(opts) do
    with {:ok, cookie} <- configured_cookie(opts) do
      if cookie, do: Node.set_cookie(cookie)
      :ok
    end
  end

  defp configured_cookie(opts) do
    case cookie(opts) do
      nil ->
        {:ok, nil}

      value when is_atom(value) ->
        {:ok, value}

      value when is_binary(value) and byte_size(value) <= 255 ->
        bounded_atom({__MODULE__, :configured_cookie}, value, 1)

      _other ->
        {:error, %{kind: :invalid_cookie, message: "Distribution cookie is invalid"}}
    end
  end

  defp cookie(opts) do
    cond do
      value = Keyword.get(opts, :cookie) -> value
      value = System.get_env("PI_ELIXIR_COOKIE") -> value
      path = System.get_env("PI_ELIXIR_COOKIE_FILE") -> path |> File.read!() |> String.trim()
      true -> nil
    end
  end

  # Distribution needs atoms. Cap the distinct values so changing targets cannot
  # exhaust the atom table.
  defp bounded_atom(key, value, limit) do
    atoms = :persistent_term.get(key, %{})

    cond do
      atom = Map.get(atoms, value) ->
        {:ok, atom}

      map_size(atoms) < limit ->
        atom = :erlang.binary_to_atom(value)
        :persistent_term.put(key, Map.put(atoms, value, atom))
        {:ok, atom}

      true ->
        {:error,
         %{
           kind: :distribution_configuration_changed,
           message: "Restart pi to change distribution identity"
         }}
    end
  end

  defp inject_runtime(node) do
    Enum.reduce_while(@runtime_modules, :ok, fn module, :ok ->
      inject_module(node, module)
    end)
  catch
    kind, reason -> {:error, %{kind: :runtime_injection_failed, reason: {kind, reason}}}
  end

  defp inject_module(node, module) do
    case :code.get_object_code(module) do
      {^module, binary, file} -> load_runtime_module(node, module, binary, file)
      :error -> {:halt, {:error, %{kind: :runtime_module_missing, module: module}}}
    end
  end

  defp load_runtime_module(node, module, binary, file) do
    case :erpc.call(node, :code, :load_binary, [module, file, binary], 10_000) do
      {:module, ^module} -> {:cont, :ok}
      {:error, reason} -> {:halt, {:error, %{kind: :runtime_injection_failed, reason: reason}}}
    end
  end

  defp evaluator(state, node, session_id, opts) do
    key = {node, session_id}

    case Map.get(state, key) do
      pid when is_pid(pid) ->
        if remote_call(node, Process, :alive?, [pid], 5_000) do
          {:ok, pid, state}
        else
          start_evaluator(state, key, node, opts)
        end

      _other ->
        start_evaluator(state, key, node, opts)
    end
  end

  defp start_evaluator(state, key, node, opts) do
    evaluator_opts = %{
      state_path: Keyword.get(opts, :state_path),
      restore_path: Keyword.get(opts, :restore_path)
    }

    case :erpc.call(node, Evaluator, :start, [evaluator_opts], 10_000) do
      {:ok, pid} -> {:ok, pid, Map.put(state, key, pid)}
      {:error, reason} -> {:error, %{kind: :evaluator_start_failed, reason: reason}, state}
    end
  catch
    kind, reason -> {:error, %{kind: :evaluator_start_failed, reason: {kind, reason}}, state}
  end

  defp evaluate(node, evaluator, code, opts, timeout) do
    request = %{
      code: code,
      state_path: Keyword.get(opts, :state_path),
      restore_path: Keyword.get(opts, :restore_path)
    }

    {:ok, :erpc.call(node, Evaluator, :evaluate, [evaluator, request], timeout)}
  catch
    kind, reason ->
      :erpc.cast(node, Process, :exit, [evaluator, :kill])
      {:error, %{kind: :attached_eval_failed, reason: {kind, reason}}}
  end

  defp remote_call(node, module, function, args, timeout),
    do: :erpc.call(node, module, function, args, timeout)
end
