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

  def dispatch("project_eval", _args), do: {:error, "Missing required parameter: code"}
  def dispatch("project_eval_sandbox", _args), do: {:error, "Missing required parameter: code"}
  def dispatch(name, _args), do: {:error, "Unknown tool: #{name}"}

  defp sandbox_result({:ok, %{stdio: "", inspected: inspected}}), do: {:ok, inspected}

  defp sandbox_result({:ok, %{stdio: stdio, inspected: inspected}}) do
    {:ok, "IO:\n\n#{stdio}\n\nResult:\n\n#{inspected}"}
  end

  defp sandbox_result({:error, :unavailable}), do: {:error, "Dune sandbox is not available"}
  defp sandbox_result({:error, message}), do: {:error, message}
end
