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

  def dispatch("project_eval_structured", %{"code" => code} = args) do
    timeout = Map.get(args, "timeout", 30_000)

    case Pi.Eval.run_structured(code, timeout: timeout) do
      {:ok, payload} -> {:ok, Jason.encode!(payload)}
      {:error, payload} when is_map(payload) -> {:error, Jason.encode!(payload)}
      {:error, message} -> {:error, message}
    end
  end

  def dispatch("project_eval_sandbox", %{"code" => code} = args) do
    timeout = Map.get(args, "timeout", 5_000)
    code |> Pi.Eval.sandbox(timeout: timeout) |> sandbox_result()
  end

  def dispatch("ex_ast_search", %{"pattern" => pattern} = args) do
    case Pi.AST.search(pattern, path: Map.get(args, "path")) do
      {:ok, payload} -> {:ok, Jason.encode!(payload)}
      {:error, message} -> {:error, message}
    end
  end

  def dispatch("ex_ast_replace", %{"pattern" => pattern, "replacement" => replacement} = args) do
    dry_run = Map.get(args, "dryRun", Map.get(args, "dry_run", false))

    case Pi.AST.replace(pattern, replacement, path: Map.get(args, "path"), dry_run: dry_run) do
      {:ok, payload} -> {:ok, Jason.encode!(payload)}
      {:error, message} -> {:error, message}
    end
  end

  def dispatch("project_eval", _args), do: {:error, "Missing required parameter: code"}
  def dispatch("project_eval_structured", _args), do: {:error, "Missing required parameter: code"}
  def dispatch("ex_ast_search", _args), do: {:error, "Missing required parameter: pattern"}

  def dispatch("ex_ast_replace", _args),
    do: {:error, "Missing required parameters: pattern and replacement"}

  def dispatch("project_eval_sandbox", _args), do: {:error, "Missing required parameter: code"}
  def dispatch(name, _args), do: {:error, "Unknown tool: #{name}"}

  defp sandbox_result({:ok, %{stdio: "", inspected: inspected}}), do: {:ok, inspected}

  defp sandbox_result({:ok, %{stdio: stdio, inspected: inspected}}) do
    {:ok, "IO:\n\n#{stdio}\n\nResult:\n\n#{inspected}"}
  end

  defp sandbox_result({:error, :unavailable}), do: {:error, "Dune sandbox is not available"}
  defp sandbox_result({:error, message}), do: {:error, message}
end
