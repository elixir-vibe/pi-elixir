defmodule Pi.Eval do
  @moduledoc "Runs bounded Elixir evals inside the project BEAM."

  @inspect_opts [charlists: :as_lists, limit: 50, pretty: true]

  def run(code, opts \\ []) when is_binary(code) do
    timeout = Keyword.get(opts, :timeout, 30_000)
    parent = self()

    reload_project()

    {pid, ref} =
      spawn_monitor(fn -> send(parent, {:result, eval_with_captured_io(code)}) end)

    receive do
      {:result, result} ->
        Process.demonitor(ref, [:flush])
        {:ok, result}

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
          _ -> :ok
        end
      end
    else
      Mix.Task.reenable("compile.elixir")
      Mix.Task.run("compile.elixir")
    end
  end

  defp eval_with_captured_io(code) do
    {{success?, result}, io} =
      capture_io(fn ->
        try do
          {result, _bindings} = Code.eval_string(code, [arguments: []], env())
          {true, result}
        catch
          kind, reason -> {false, Exception.format(kind, reason, __STACKTRACE__)}
        end
      end)

    case result do
      :"do not show this result in output" -> io
      _ when not success? -> result
      _ when io == "" -> inspect(result, @inspect_opts)
      _ -> "IO:\n\n#{io}\n\nResult:\n\n#{inspect(result, @inspect_opts)}"
    end
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
