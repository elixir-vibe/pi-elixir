unless Code.ensure_loaded?(ExAST) do
  raise "ex_ast is not installed. Add {:ex_ast, \"~> 0.1\", only: [:dev, :test], runtime: false} to mix.exs"
end

paths =
  case path do
    nil -> ["lib/"]
    p -> [p]
  end

results = ExAST.search(paths, pattern)

if results == [] do
  "No matches found."
else
  lines =
    Enum.map(results, fn %{file: file, line: line, source: source, captures: captures} ->
      header = "#{file}:#{line}"
      body = source |> String.split("\n") |> Enum.map_join("\n", &("  " <> &1))

      caps =
        if map_size(captures) > 0 do
          Enum.map_join(captures, "\n", fn {name, value} ->
            rendered =
              Macro.prewalk(value, fn
                {form, nil, args} -> {form, [], args}
                other -> other
              end)
              |> Macro.to_string()

            "  #{name}: #{rendered}"
          end)
        end

      [header, body, caps] |> Enum.reject(&is_nil/1) |> Enum.join("\n")
    end)

  Enum.join(lines, "\n\n") <> "\n\n#{length(results)} match(es)"
end
