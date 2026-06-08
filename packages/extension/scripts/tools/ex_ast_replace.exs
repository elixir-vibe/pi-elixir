if Code.ensure_loaded?(ExAST) do
  paths =
    case path do
      nil -> ["lib/"]
      p -> [p]
    end

  results = ExAST.replace(paths, pattern, replacement, dry_run: dry_run)

  replacements =
    Enum.map(results, fn {file, count} ->
      %{file: file, count: count}
    end)

  total = Enum.reduce(replacements, 0, fn %{count: count}, acc -> acc + count end)

  Jason.encode!(%{
    kind: "ast_replace",
    dry_run: dry_run,
    pattern: pattern,
    replacement: replacement,
    path: path,
    replacements: replacements,
    total: total
  })
else
  "ex_ast is not installed. Add {:ex_ast, \"~> 0.1\", only: [:dev, :test], runtime: false} to mix.exs"
end
