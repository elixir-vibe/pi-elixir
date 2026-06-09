defmodule Pi.AST do
  @moduledoc "Structured ExAST helpers for bridge tools."

  alias Pi.Protocol.Tool.AST.Diff
  alias Pi.Protocol.Tool.AST.Match
  alias Pi.Protocol.Tool.AST.Replace
  alias Pi.Protocol.Tool.AST.Replacement
  alias Pi.Protocol.Tool.AST.Search
  alias Pi.Protocol.UI.Block
  alias Pi.Protocol.UI.Display

  @missing_ex_ast "ex_ast is not installed. Add {:ex_ast, \"~> 0.1\", only: [:dev, :test], runtime: false} to mix.exs"

  def search(pattern, opts \\ []) when is_binary(pattern) do
    with :ok <- ensure_ex_ast() do
      path = Keyword.get(opts, :path)
      paths = paths(path)

      matches =
        paths
        |> ExAST.search(pattern, search_opts(opts))
        |> Enum.map(&match_payload/1)

      {:ok,
       %Search{
         pattern: pattern,
         path: path,
         matches: matches,
         total: length(matches),
         display: search_display(matches)
       }}
    end
  end

  def search_many(patterns, opts \\ []) when is_map(patterns) or is_list(patterns) do
    with :ok <- ensure_ex_ast() do
      path = Keyword.get(opts, :path)
      paths = paths(path)

      matches =
        patterns
        |> Enum.flat_map(fn {name, pattern} ->
          paths
          |> ExAST.search(pattern, search_opts(opts))
          |> Enum.map(&Map.put(&1, :pattern, to_string(name)))
        end)
        |> maybe_limit(Keyword.get(opts, :limit))
        |> Enum.map(&match_payload/1)

      {:ok,
       %Search{
         pattern: inspect(patterns, limit: 20),
         path: path,
         matches: matches,
         total: length(matches),
         display: search_display(matches)
       }}
    end
  end

  def replace(pattern, replacement, opts \\ [])
      when is_binary(pattern) and is_binary(replacement) do
    with :ok <- ensure_ex_ast() do
      path = Keyword.get(opts, :path)
      dry_run = Keyword.get(opts, :dry_run, false)

      paths = paths(path)
      opts = Keyword.merge(search_opts(opts), dry_run: dry_run)
      diffs = if dry_run, do: replacement_diffs(paths, pattern, replacement, opts), else: []

      replacements =
        paths
        |> ExAST.replace(pattern, replacement, opts)
        |> Enum.map(fn {file, count} -> %Replacement{file: file, count: count} end)

      total = Enum.reduce(replacements, 0, fn %Replacement{count: count}, acc -> acc + count end)

      {:ok,
       %Replace{
         dry_run: dry_run,
         pattern: pattern,
         replacement: replacement,
         path: path,
         replacements: replacements,
         total: total,
         diffs: diffs,
         display: replace_display(replacements, diffs)
       }}
    end
  end

  defp search_opts(opts) do
    []
    |> maybe_put(:inside, Keyword.get(opts, :inside))
    |> maybe_put(:not_inside, Keyword.get(opts, :not_inside))
    |> maybe_put(:allow_broad, Keyword.get(opts, :allow_broad))
    |> maybe_put(:limit, Keyword.get(opts, :limit))
  end

  defp maybe_put(opts, _key, nil), do: opts
  defp maybe_put(opts, key, value), do: Keyword.put(opts, key, value)

  defp match_payload(%{file: file, line: line, source: source, captures: captures}) do
    %Match{file: file, line: line, source: source, captures: render_captures(captures)}
  end

  defp match_payload(%{file: file, line: line, source: source} = match) do
    captures =
      match
      |> Map.take([:pattern])
      |> Map.new(fn {key, value} -> {to_string(key), value} end)

    %Match{file: file, line: line, source: source, captures: captures}
  end

  defp maybe_limit(matches, nil), do: matches
  defp maybe_limit(matches, limit) when is_integer(limit), do: Enum.take(matches, limit)

  defp search_display(matches) do
    %Display{
      summary: "#{length(matches)} match(es)",
      blocks:
        Enum.flat_map(matches, fn %Match{} = match ->
          [
            %Block{type: :location, path: match.file, line: match.line},
            %Block{type: :source, text: match.source, language: language_from_path(match.file)}
          ]
        end)
    }
  end

  defp replace_display(replacements, diffs) do
    replacement_blocks =
      Enum.map(replacements, fn %Replacement{} = replacement ->
        %Block{
          type: :text,
          text: "#{replacement.file}: #{replacement.count} replacement(s)",
          path: replacement.file
        }
      end)

    diff_blocks =
      Enum.map(diffs, fn %Diff{} = diff ->
        %Block{type: :diff, text: diff.diff, path: diff.file, language: diff.language}
      end)

    %Display{
      summary: "#{length(replacements)} file(s)",
      blocks: replacement_blocks ++ diff_blocks
    }
  end

  defp replacement_diffs(paths, pattern, replacement, opts) do
    opts = Keyword.drop(opts, [:dry_run])

    paths
    |> Enum.flat_map(&resolve_paths/1)
    |> Enum.flat_map(fn file ->
      source = File.read!(file)
      replaced = ExAST.Patcher.replace_all(source, pattern, replacement, opts)

      if source == replaced do
        []
      else
        [%Diff{file: file, diff: unified_diff(source, replaced, file)}]
      end
    end)
  end

  defp unified_diff(old, new, file) do
    old_lines = String.split(old, "\n")
    new_lines = String.split(new, "\n")

    if old == new do
      ""
    else
      ["--- ", file, "\n", "+++ ", file, "\n" | diff_lines(old_lines, new_lines)]
      |> IO.iodata_to_binary()
    end
  end

  defp diff_lines(old_lines, new_lines) do
    max = max(length(old_lines), length(new_lines))

    0..(max - 1)
    |> Enum.flat_map(fn index ->
      old_line = Enum.at(old_lines, index)
      new_line = Enum.at(new_lines, index)

      cond do
        old_line == new_line -> if is_nil(old_line), do: [], else: [" ", old_line, "\n"]
        is_nil(old_line) -> ["+", new_line, "\n"]
        is_nil(new_line) -> ["-", old_line, "\n"]
        true -> ["-", old_line, "\n", "+", new_line, "\n"]
      end
    end)
  end

  defp resolve_paths(path) when is_binary(path) do
    cond do
      String.contains?(path, "*") -> Path.wildcard(path)
      File.dir?(path) -> Path.wildcard(Path.join(path, "**/*.ex*"))
      true -> [path]
    end
  end

  defp language_from_path(path) do
    case Path.extname(path || "") do
      ".ex" -> "elixir"
      ".exs" -> "elixir"
      ".heex" -> "heex"
      ext -> String.trim_leading(ext, ".")
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
