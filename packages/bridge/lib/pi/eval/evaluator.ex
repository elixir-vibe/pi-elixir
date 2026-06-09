defmodule Pi.Eval.Evaluator do
  @moduledoc "Per-session Livebook-style stateful Elixir evaluator."

  use GenServer

  alias Pi.Bridge.Info
  alias Pi.Eval.Snapshot
  alias Pi.Protocol.Tool.Eval, as: EvalPayload
  alias Pi.Protocol.Tool.OutputPart
  alias Pi.Protocol.UI.Block
  alias Pi.Protocol.UI.Display

  @inspect_opts [charlists: :as_lists, limit: 50, pretty: true]
  @control_key {Pi.Eval, :control}
  @binding_info_key {Pi.Eval, :binding_info}
  @session_id_key {Pi.Eval, :session_id}

  defstruct session_id: nil,
            binding: [],
            env: nil,
            state_path: nil,
            restore_path: nil,
            loaded_path: nil

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    session_id = Keyword.fetch!(opts, :session_id)
    GenServer.start_link(__MODULE__, opts, name: via(session_id))
  end

  @spec evaluate(GenServer.server(), String.t(), keyword()) ::
          {:ok, EvalPayload.t()} | {:error, EvalPayload.t()}
  def evaluate(server, code, opts \\ []) when is_binary(code) do
    GenServer.call(server, {:evaluate, code, opts}, :infinity)
  end

  @spec bindings(GenServer.server()) :: [map()]
  def bindings(server), do: GenServer.call(server, :bindings)

  @spec forget(GenServer.server(), [atom()]) :: :ok
  def forget(server, names), do: GenServer.call(server, {:forget, names})

  @spec reset(GenServer.server()) :: :ok
  def reset(server), do: GenServer.call(server, :reset)

  @impl true
  def init(opts) do
    state_path = Keyword.get(opts, :state_path)
    restore_path = Keyword.get(opts, :restore_path, state_path)
    {binding, env, loaded_path} = initial_context(restore_path)

    {:ok,
     %__MODULE__{
       session_id: Keyword.fetch!(opts, :session_id),
       binding: binding,
       env: env,
       state_path: state_path,
       restore_path: restore_path,
       loaded_path: loaded_path
     }}
  end

  @impl true
  def handle_call({:evaluate, code, opts}, _from, state) do
    state = maybe_update_paths(state, opts)
    {reply, state} = eval_with_captured_io(code, state)
    {:reply, reply, state}
  end

  def handle_call(:bindings, _from, state),
    do: {:reply, Snapshot.binding_info(state.binding), state}

  def handle_call({:forget, names}, _from, state) do
    state = forget_names(state, names)
    persist(state)
    {:reply, :ok, state}
  end

  def handle_call(:reset, _from, state) do
    state = %{state | binding: [], env: initial_env()}
    persist(state)
    {:reply, :ok, state}
  end

  defp maybe_update_paths(state, opts) do
    state_path = Keyword.get(opts, :state_path, state.state_path)
    restore_path = Keyword.get(opts, :restore_path, state.restore_path)

    if state_path == state.state_path do
      %{state | restore_path: restore_path}
    else
      {binding, env, loaded_path} = initial_context(restore_path || state_path)

      %{
        state
        | binding: binding,
          env: env,
          state_path: state_path,
          restore_path: restore_path,
          loaded_path: loaded_path
      }
    end
  end

  defp eval_with_captured_io(code, state) do
    {{success?, result, state}, io} = capture_io(fn -> eval_code(code, state) end)

    cond do
      success? ->
        state = apply_control(state)
        persist_meta = persist(state)
        {{:ok, structured_result(result, io, state, persist_meta)}, state}

      io != "" ->
        text = "IO:\n\n#{io}\n\nError:\n\n#{result}"
        {{:error, error_result(text, io, state)}, state}

      true ->
        {{:error, error_result(result, io, state)}, state}
    end
  end

  defp eval_code(code, state) do
    Process.put(@session_id_key, state.session_id)
    Process.put(@binding_info_key, Snapshot.binding_info(state.binding))
    Process.delete(@control_key)

    try do
      {result, _diagnostics} =
        Code.with_diagnostics([log: false], fn ->
          quoted =
            Code.string_to_quoted!(prepend_aliases(code), file: eval_file(state.session_id))

          {result, binding, env} =
            Code.eval_quoted_with_env(quoted, state.binding, state.env, prune_binding: true)

          state = %{state | binding: merge_binding(state.binding, binding), env: env}
          {true, result, state}
        end)

      result
    catch
      kind, reason -> {false, Exception.format(kind, reason, __STACKTRACE__), state}
    after
      Process.delete(@session_id_key)
      Process.delete(@binding_info_key)
    end
  end

  defp structured_result(:"do not show this result in output", io, state, persist_meta) do
    parts = if io == "", do: [], else: [%OutputPart{format: :text, output: io}]

    %EvalPayload{
      io: io,
      result: nil,
      text: io,
      parts: parts,
      display: display(parts),
      bindings: Snapshot.binding_info(state.binding),
      state: eval_state_meta(state, persist_meta)
    }
  end

  defp structured_result(result, io, state, persist_meta) do
    inspected = inspect(result, @inspect_opts)

    parts =
      []
      |> maybe_io_part(io)
      |> Kernel.++([%OutputPart{format: :inspect, output: inspected, language: "elixir"}])

    text = if io == "", do: inspected, else: "IO:\n\n#{io}\n\nResult:\n\n#{inspected}"

    %EvalPayload{
      io: io,
      result: inspected,
      text: text,
      parts: parts,
      display: display(parts),
      bindings: Snapshot.binding_info(state.binding),
      state: eval_state_meta(state, persist_meta)
    }
  end

  defp error_result(text, io, state) do
    parts = [] |> maybe_io_part(io) |> Kernel.++([%OutputPart{format: :error, output: text}])

    %EvalPayload{
      io: io,
      error: text,
      text: text,
      parts: parts,
      display: display(parts),
      bindings: Snapshot.binding_info(state.binding),
      state: eval_state_meta(state, %{persisted?: false})
    }
  end

  defp maybe_io_part(parts, ""), do: parts
  defp maybe_io_part(parts, io), do: parts ++ [%OutputPart{format: :text, output: io}]
  defp display(parts), do: %Display{blocks: Enum.map(parts, &part_block/1)}

  defp part_block(%OutputPart{} = part) do
    struct(Block, type: part.format, text: part.output, language: part.language)
  end

  defp eval_state_meta(state, persist_meta) do
    %{
      sessionId: state.session_id,
      persisted: Map.get(persist_meta, :persisted?, false),
      bytes: Map.get(persist_meta, :bytes),
      bindingCount: length(state.binding),
      droppedBindings: Map.get(persist_meta, :dropped_bindings, []),
      loadedPath: state.loaded_path
    }
  end

  defp apply_control(state) do
    case Process.get(@control_key) do
      :reset -> %{state | binding: [], env: initial_env()}
      {:forget, names} -> forget_names(state, names)
      _other -> state
    end
  end

  defp forget_names(state, names) do
    names = MapSet.new(names)

    %{
      state
      | binding: Enum.reject(state.binding, fn {name, _value} -> MapSet.member?(names, name) end),
        env: prune_env_vars(state.env, names)
    }
  end

  defp persist(state) do
    case Snapshot.store(state.state_path, state.binding, state.env, []) do
      {:ok, meta} -> meta
      {:error, reason} -> %{persisted?: false, error: inspect(reason)}
    end
  end

  defp initial_context(path) do
    case Snapshot.load(path) do
      {:ok, %{binding: binding, env: %Macro.Env{} = env}} -> {binding, env, path}
      :error -> {[], initial_env(), nil}
    end
  end

  defp initial_env do
    env = Code.env_for_eval([])

    if Code.ensure_loaded?(IEx.Helpers) do
      {_result, _binding, env} =
        "import IEx.Helpers, warn: false"
        |> Code.string_to_quoted!()
        |> Code.eval_quoted_with_env([], env, prune_binding: true)

      env
    else
      env
    end
  end

  defp prepend_aliases(code) do
    case Info.aliases_code() do
      "" -> code
      aliases -> aliases <> "\n" <> code
    end
  end

  defp merge_binding(previous, current) do
    current_names = MapSet.new(current, &elem(&1, 0))
    current ++ Enum.reject(previous, fn {name, _value} -> MapSet.member?(current_names, name) end)
  end

  defp prune_env_vars(env, names) do
    Map.update!(env, :versioned_vars, fn versioned_vars ->
      Map.reject(versioned_vars, fn {{name, _context}, _version} ->
        MapSet.member?(names, name)
      end)
    end)
  end

  defp capture_io(fun) do
    {:ok, pid} = StringIO.open("")
    original = Application.get_env(:elixir, :ansi_enabled)
    original_gl = Process.group_leader()
    Application.put_env(:elixir, :ansi_enabled, false)
    Process.group_leader(self(), pid)

    try do
      result = fun.()
      {_, content} = StringIO.contents(pid)
      {result, content}
    after
      Process.group_leader(self(), original_gl)
      StringIO.close(pid)
      Application.put_env(:elixir, :ansi_enabled, original)
    end
  end

  defp eval_file(session_id), do: "pi://eval/" <> session_id
  defp via(session_id), do: {:via, Registry, {Pi.Eval.Registry, session_id}}

  @doc false
  def current_session_id, do: Process.get(@session_id_key)

  @doc false
  def current_binding_info, do: Process.get(@binding_info_key, [])

  @doc false
  def put_control(control), do: Process.put(@control_key, control)
end
