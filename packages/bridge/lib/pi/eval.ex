defmodule Pi.Eval do
  @moduledoc "Runs bounded Elixir evals inside the project BEAM."

  alias Pi.Bridge.Info
  alias Pi.Eval.{Evaluator, ExceptionInfo, Sandbox, Supervisor}
  alias Pi.Protocol.Tool.Eval, as: EvalPayload
  alias Pi.Protocol.Tool.OutputPart
  alias Pi.Protocol.UI.Block
  alias Pi.Protocol.UI.Display

  @inspect_opts [charlists: :as_lists, limit: 50, pretty: true]
  @preview_inspect_opts [
    charlists: :as_lists,
    limit: 20,
    pretty: false,
    printable_limit: 200,
    width: 1_000_000
  ]

  def sandbox(code, opts \\ []) when is_binary(code), do: Sandbox.eval(code, opts)

  def run_structured(code, opts \\ []) when is_binary(code) do
    run_eval(code, opts, :structured)
  end

  def run(code, opts \\ []) when is_binary(code) do
    run_eval(code, opts, :text)
  end

  @doc "Returns binding metadata for the current eval process."
  def bindings, do: Evaluator.current_binding_info()

  @doc "Returns binding metadata for a stateful eval session."
  def bindings(session_id) when is_binary(session_id) do
    with {:ok, evaluator} <- Supervisor.evaluator(session_id) do
      Evaluator.bindings(evaluator)
    end
  end

  @doc "Schedules reset when called from inside eval."
  def reset, do: Evaluator.put_control(:reset)

  @doc "Clears a stateful eval session."
  def reset(session_id) when is_binary(session_id) do
    with {:ok, evaluator} <- Supervisor.evaluator(session_id), do: Evaluator.reset(evaluator)
  end

  @doc "Schedules forget when called from inside eval."
  def forget(names), do: Evaluator.put_control({:forget, normalize_names!(names)})

  @doc "Forgets bindings in a stateful eval session."
  def forget(names, session_id) when is_binary(session_id) do
    with {:ok, evaluator} <- Supervisor.evaluator(session_id) do
      Evaluator.forget(evaluator, normalize_names!(names))
    end
  end

  defp run_eval(code, opts, mode) do
    timeout = Keyword.get(opts, :timeout, 30_000)

    reload_project()

    case {mode, Keyword.get(opts, :session_id)} do
      {:structured, session_id} when is_binary(session_id) ->
        run_stateful_eval(code, opts, timeout, session_id)

      _other ->
        run_stateless_eval(code, timeout, mode)
    end
  end

  defp run_stateful_eval(code, opts, timeout, session_id) do
    case Supervisor.evaluator(session_id,
           state_path: Keyword.get(opts, :state_path),
           restore_path: Keyword.get(opts, :restore_path)
         ) do
      {:ok, evaluator} ->
        await_eval(timeout, fn ->
          Evaluator.evaluate(evaluator, code,
            state_path: Keyword.get(opts, :state_path),
            restore_path: Keyword.get(opts, :restore_path)
          )
        end)

      {:error, reason} ->
        {:error, inspect(reason)}
    end
  end

  defp run_stateless_eval(code, timeout, mode) do
    code = prepend_aliases(code)
    await_eval(timeout, fn -> eval_with_captured_io(code, mode) end)
  end

  defp await_eval(timeout, fun) when is_function(fun, 0) do
    parent = self()
    {pid, ref} = spawn_monitor(fn -> send(parent, {:result, fun.()}) end)

    receive do
      {:result, result} ->
        Process.demonitor(ref, [:flush])
        result

      {:DOWN, ^ref, :process, ^pid, reason} ->
        {:error, "Process exited: #{Exception.format_exit(reason)}"}
    after
      timeout ->
        Process.demonitor(ref, [:flush])
        Process.exit(pid, :brutal_kill)
        {:error, "Evaluation timed out after #{timeout}ms"}
    end
  end

  defp reload_project do
    reloader = :"Elixir.Phoenix.CodeReloader"

    if Code.ensure_loaded?(reloader) do
      for endpoint <- endpoints() do
        try do
          apply(reloader, :reload, [endpoint])
        rescue
          _exception in [ArgumentError, RuntimeError, UndefinedFunctionError] -> :ok
        end
      end
    else
      Mix.Task.reenable("compile.elixir")
      Mix.Task.run("compile.elixir")
    end
  end

  defp prepend_aliases(code) do
    case Info.aliases_code() do
      "" -> code
      aliases -> aliases <> "\n" <> code
    end
  end

  defp eval_with_captured_io(code, mode) do
    {{success?, result}, io} =
      capture_io(fn ->
        try do
          {result, _bindings} = Code.eval_string(code, [arguments: []], env())
          {true, result}
        catch
          kind, reason ->
            stacktrace = __STACKTRACE__
            text = Exception.format(kind, reason, stacktrace)

            {false, %{text: text, exception: ExceptionInfo.payload(kind, reason, stacktrace)}}
        end
      end)

    formatted = format_eval_result(result, success?, io)

    case mode do
      :structured -> structured_eval_result(result, success?, io, formatted)
      :text -> formatted
    end
  end

  defp error_text(%{text: text}) when is_binary(text), do: text
  defp error_text(text) when is_binary(text), do: text

  defp error_exception(%{exception: exception}) when is_map(exception), do: exception
  defp error_exception(_), do: nil

  defp format_eval_result(result, success?, io) do
    case {result, success?, io} do
      {:"do not show this result in output", true, io} -> {:ok, io}
      {result, false, ""} -> {:error, error_text(result)}
      {result, false, io} -> {:error, "IO:\n\n#{io}\n\nError:\n\n#{error_text(result)}"}
      {result, true, ""} -> {:ok, inspect(result, @inspect_opts)}
      {result, true, io} -> {:ok, "IO:\n\n#{io}\n\nResult:\n\n#{inspect(result, @inspect_opts)}"}
    end
  end

  defp structured_eval_result(:"do not show this result in output", true, io, {:ok, text}) do
    parts = if io == "", do: [], else: [%OutputPart{format: :text, output: io}]
    {:ok, %EvalPayload{io: io, result: nil, text: text, parts: parts, display: display(parts)}}
  end

  defp structured_eval_result(result, true, io, {:ok, text}) do
    inspected = inspect(result, @inspect_opts)
    preview = inspect(result, @preview_inspect_opts)

    parts =
      []
      |> maybe_io_part(io)
      |> Kernel.++([
        %OutputPart{format: :inspect, output: inspected, language: "elixir", preview: preview}
      ])

    {:ok,
     %EvalPayload{io: io, result: inspected, text: text, parts: parts, display: display(parts)}}
  end

  defp structured_eval_result(result, false, io, {:error, text}) do
    parts =
      []
      |> maybe_io_part(io)
      |> Kernel.++([%OutputPart{format: :error, output: text}])

    {:error,
     %EvalPayload{
       io: io,
       error: text,
       exception: error_exception(result),
       text: text,
       parts: parts,
       display: display(parts)
     }}
  end

  defp maybe_io_part(parts, ""), do: parts
  defp maybe_io_part(parts, io), do: parts ++ [%OutputPart{format: :text, output: io}]

  defp display(parts) do
    %Display{blocks: Enum.map(parts, &part_block/1)}
  end

  defp part_block(%OutputPart{format: format, output: output, language: language}) do
    %Block{type: format, text: output, language: language}
  end

  defp normalize_names!(name) when is_atom(name), do: [name]

  defp normalize_names!(name) when is_binary(name), do: [String.to_existing_atom(name)]

  defp normalize_names!(names) when is_list(names) do
    Enum.map(names, fn
      name when is_atom(name) -> name
      name when is_binary(name) -> String.to_existing_atom(name)
    end)
  end

  defp env do
    import IEx.Helpers, warn: false
    __ENV__
  end

  defp capture_io(fun) do
    {:ok, pid} = StringIO.open("")
    original = Application.get_env(:elixir, :ansi_enabled)
    Application.put_env(:elixir, :ansi_enabled, false)
    original_gl = Process.group_leader()
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

  defp endpoints do
    for {app, _, _} <- Application.started_applications(),
        mod <- (Application.get_env(app, :phoenix_endpoint) || []) |> List.wrap() do
      mod
    end
  end
end
