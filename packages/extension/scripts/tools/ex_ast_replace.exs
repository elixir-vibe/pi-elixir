unless Code.ensure_loaded?(ExAST) do
  raise "ex_ast is not installed. Add {:ex_ast, \"~> 0.1\", only: [:dev, :test], runtime: false} to mix.exs"
end

paths =
  case path do
    nil -> ["lib/"]
    p -> [p]
  end

results = ExAST.replace(paths, pattern, replacement, dry_run: dry_run)

case results do
  [] ->
    "No matches found."

  files ->
    total = files |> Enum.map(&elem(&1, 1)) |> Enum.sum()
    verb = if dry_run, do: "Would update", else: "Updated"

    lines = Enum.map(files, fn {file, count} -> "#{verb} #{file} (#{count} replacement(s))" end)
    Enum.join(lines, "\n") <> "\n\n#{total} replacement(s) in #{length(files)} file(s)"
end
