defmodule Pi.MCP.Tools do
  @moduledoc "MCP tool dispatch for the embedded server."

  def dispatch("project_eval", %{"code" => code, "mode" => "sandbox"} = args) do
    timeout = Map.get(args, "timeout", 5_000)
    code |> Pi.Eval.sandbox(timeout: timeout) |> sandbox_result()
  end

  def dispatch("project_eval", %{"code" => code} = args) do
    timeout = Map.get(args, "timeout", 30_000)
    Pi.Eval.run(code, timeout: timeout)
  end

  def dispatch("project_eval_sandbox", %{"code" => code} = args) do
    timeout = Map.get(args, "timeout", 5_000)
    code |> Pi.Eval.sandbox(timeout: timeout) |> sandbox_result()
  end

  def dispatch("ex_ast_replace", %{"pattern" => pattern, "replacement" => replacement} = args) do
    if Code.ensure_loaded?(ExAST) do
      path = Map.get(args, "path")
      dry_run = Map.get(args, "dryRun", Map.get(args, "dry_run", false))
      paths = if is_binary(path), do: [path], else: ["lib/"]

      replacements =
        paths
        |> ExAST.replace(pattern, replacement, dry_run: dry_run)
        |> Enum.map(fn {file, count} -> %{file: file, count: count} end)

      total = Enum.reduce(replacements, 0, fn %{count: count}, acc -> acc + count end)

      {:ok,
       Jason.encode!(%{
         kind: "ast_replace",
         dry_run: dry_run,
         pattern: pattern,
         replacement: replacement,
         path: path,
         replacements: replacements,
         total: total
       })}
    else
      {:error,
       "ex_ast is not installed. Add {:ex_ast, \"~> 0.1\", only: [:dev, :test], runtime: false} to mix.exs"}
    end
  end

  def dispatch("project_eval", _args), do: {:error, "Missing required parameter: code"}
  def dispatch("ex_ast_replace", _args), do: {:error, "Missing required parameters: pattern and replacement"}
  def dispatch("project_eval_sandbox", _args), do: {:error, "Missing required parameter: code"}
  def dispatch(name, _args), do: {:error, "Unknown tool: #{name}"}

  defp sandbox_result({:ok, %{stdio: "", inspected: inspected}}), do: {:ok, inspected}

  defp sandbox_result({:ok, %{stdio: stdio, inspected: inspected}}) do
    {:ok, "IO:\n\n#{stdio}\n\nResult:\n\n#{inspected}"}
  end

  defp sandbox_result({:error, :unavailable}), do: {:error, "Dune sandbox is not available"}
  defp sandbox_result({:error, message}), do: {:error, message}
end
