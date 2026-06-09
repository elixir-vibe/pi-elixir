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
      {:ok, payload} -> {:ok, encode_payload(payload)}
      {:error, payload} when is_struct(payload) -> {:error, encode_payload(payload)}
      {:error, message} -> {:error, message}
    end
  end

  def dispatch("project_eval_sandbox", %{"code" => code} = args) do
    timeout = Map.get(args, "timeout", 5_000)
    code |> Pi.Eval.sandbox(timeout: timeout) |> sandbox_result()
  end

  def dispatch("ex_ast_search", %{"pattern" => pattern} = args) do
    case Pi.AST.search(pattern, path: Map.get(args, "path")) do
      {:ok, payload} -> {:ok, encode_payload(payload)}
      {:error, message} -> {:error, message}
    end
  end

  def dispatch("ex_ast_replace", %{"pattern" => pattern, "replacement" => replacement} = args) do
    dry_run = Map.get(args, "dryRun", Map.get(args, "dry_run", false))

    case Pi.AST.replace(pattern, replacement, path: Map.get(args, "path"), dry_run: dry_run) do
      {:ok, payload} -> {:ok, encode_payload(payload)}
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

  defp encode_payload(%module{} = payload) do
    payload
    |> module.to_map()
    |> normalize()
    |> Jason.encode!()
  end

  defp normalize(map) when is_map(map) do
    Map.new(map, fn
      {"dry_run", value} -> {"dry_run", normalize_boolean(value)}
      {key, value} -> {key, normalize_value(value)}
    end)
  end

  defp normalize_boolean(value) when is_boolean(value), do: value
  defp normalize_boolean("true"), do: true
  defp normalize_boolean("false"), do: false
  defp normalize_boolean(value), do: value

  defp normalize_value(%module{} = value) do
    if function_exported?(module, :to_map, 1),
      do: value |> module.to_map() |> normalize(),
      else: value |> Map.from_struct() |> normalize()
  end

  defp normalize_value(value) when is_list(value), do: Enum.map(value, &normalize_value/1)
  defp normalize_value(value) when is_map(value), do: normalize(value)
  defp normalize_value(value), do: value
end
