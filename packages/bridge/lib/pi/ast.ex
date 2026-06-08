defmodule Pi.AST do
  @moduledoc "Structured ExAST helpers for bridge tools."

  @missing_ex_ast "ex_ast is not installed. Add {:ex_ast, \"~> 0.1\", only: [:dev, :test], runtime: false} to mix.exs"

  def search(pattern, opts \\ []) when is_binary(pattern) do
    with :ok <- ensure_ex_ast() do
      path = Keyword.get(opts, :path)
      paths = paths(path)

      matches =
        paths
        |> ExAST.search(pattern)
        |> Enum.map(fn %{file: file, line: line, source: source, captures: captures} ->
          %{
            file: file,
            line: line,
            source: source,
            captures: render_captures(captures)
          }
        end)

      {:ok,
       %{
         kind: "ast_search",
         pattern: pattern,
         path: path,
         matches: matches,
         total: length(matches)
       }}
    end
  end

  def replace(pattern, replacement, opts \\ [])
      when is_binary(pattern) and is_binary(replacement) do
    with :ok <- ensure_ex_ast() do
      path = Keyword.get(opts, :path)
      dry_run = Keyword.get(opts, :dry_run, false)

      replacements =
        path
        |> paths()
        |> ExAST.replace(pattern, replacement, dry_run: dry_run)
        |> Enum.map(fn {file, count} -> %{file: file, count: count} end)

      total = Enum.reduce(replacements, 0, fn %{count: count}, acc -> acc + count end)

      {:ok,
       %{
         kind: "ast_replace",
         dry_run: dry_run,
         pattern: pattern,
         replacement: replacement,
         path: path,
         replacements: replacements,
         total: total
       }}
    end
  end

  defp ensure_ex_ast do
    if Code.ensure_loaded?(ExAST), do: :ok, else: {:error, @missing_ex_ast}
  end

  defp paths(path) when is_binary(path), do: [path]
  defp paths(_path), do: ["lib/"]

  defp render_captures(captures) when map_size(captures) == 0, do: %{}

  defp render_captures(captures) do
    Map.new(captures, fn {name, value} ->
      rendered =
        Macro.prewalk(value, fn
          {form, nil, args} -> {form, [], args}
          other -> other
        end)
        |> Macro.to_string()

      {to_string(name), rendered}
    end)
  end
end
