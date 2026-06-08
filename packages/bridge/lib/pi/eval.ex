defmodule Pi.Eval do
  @moduledoc "Runs bounded Elixir evals inside the project BEAM."

  alias Pi.Bridge.Info
  alias Pi.Eval.Sandbox

  @inspect_opts [charlists: :as_lists, limit: 50, pretty: true]

  def sandbox(code, opts \\ []) when is_binary(code), do: Sandbox.eval(code, opts)

  def run_structured(code, opts \\ []) when is_binary(code) do
    run_eval(code, opts, :structured)
  end

  def run(code, opts \\ []) when is_binary(code) do
    run_eval(code, opts, :text)
  end

  defp run_eval(code, opts, mode) do
    timeout = Keyword.get(opts, :timeout, 30_000)
    parent = self()

    reload_project()
    code = prepend_aliases(code)

    {pid, ref} =
      spawn_monitor(fn -> send(parent, {:result, eval_with_captured_io(code, mode)}) end)

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
          kind, reason -> {false, Exception.format(kind, reason, __STACKTRACE__)}
        end
      end)

    formatted = format_eval_result(result, success?, io)

    case mode do
      :structured -> structured_eval_result(result, success?, io, formatted)
      :text -> formatted
    end
  end

  defp format_eval_result(result, success?, io) do
    case {result, success?, io} do
      {:"do not show this result in output", true, io} -> {:ok, io}
      {result, false, ""} -> {:error, result}
      {result, false, io} -> {:error, "IO:\n\n#{io}\n\nError:\n\n#{result}"}
      {result, true, ""} -> {:ok, inspect(result, @inspect_opts)}
      {result, true, io} -> {:ok, "IO:\n\n#{io}\n\nResult:\n\n#{inspect(result, @inspect_opts)}"}
    end
  end

  defp structured_eval_result(:"do not show this result in output", true, io, {:ok, text}) do
    {:ok, %{kind: "eval", io: io, result: nil, text: text}}
  end

  defp structured_eval_result(result, true, io, {:ok, text}) do
    {:ok, %{kind: "eval", io: io, result: inspect(result, @inspect_opts), text: text}}
  end

  defp structured_eval_result(_result, false, io, {:error, text}) do
    {:error, %{kind: "eval", io: io, error: text, text: text}}
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
