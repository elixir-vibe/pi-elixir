defmodule Pi.MCP.Tools do
  @moduledoc "MCP tool dispatch for the embedded server."

  def dispatch("project_eval", %{"code" => code} = args) do
    timeout = Map.get(args, "timeout", 30_000)
    Pi.Eval.run(code, timeout: timeout)
  end

  def dispatch("project_eval", _args), do: {:error, "Missing required parameter: code"}
  def dispatch(name, _args), do: {:error, "Unknown tool: #{name}"}
end
