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
        |> ex_ast_search(pattern, search_opts(opts))
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
      named_patterns = normalize_named_patterns(patterns)

      matches =
        paths
        |> ex_ast_search_many(named_patterns, search_opts(opts))
        |> Enum.map(&match_payload/1)

      {:ok,
       %Search{
         pattern: inspect(named_patterns, limit: 20),
         path: path,
         matches: matches,
         total: length(matches),
         display: search_display(matches)
       }}
    end
  end

  def diff(opts \\ []) do
    with :ok <- ensure_ex_ast() do
      paths = diff_paths(opts)

      files =
        paths
        |> Enum.map(&semantic_file_diff/1)
        |> Enum.reject(&(&1.edits == []))

      total = Enum.reduce(files, 0, fn file, acc -> acc + length(file.edits) end)

      Pi.Output.tree(
        %{
          summary: semantic_diff_summary(total, files),
          total: total,
          files: files
        },
        opts
        |> Keyword.take([:depth])
        |> Keyword.put_new(:depth, 6)
        |> Keyword.put(:preview, semantic_diff_summary(total, files))
      )
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
        |> ex_ast_replace(pattern, replacement, opts)
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

  defp normalize_named_patterns(patterns) when is_map(patterns) and map_size(patterns) <= 50 do
    Map.new(patterns, fn {name, pattern} -> {pattern_name(name), pattern} end)
  end

  defp normalize_named_patterns(patterns) when is_map(patterns) do
    raise ArgumentError, "expected at most 50 named AST patterns"
  end

  defp normalize_named_patterns(patterns) when is_list(patterns), do: patterns

  defp pattern_name(name) when is_atom(name), do: name

  defp pattern_name(name) when is_binary(name) and byte_size(name) <= 64 do
    if String.match?(name, ~r/^[A-Za-z_][A-Za-z0-9_]*$/u) do
      String.to_existing_atom(name)
    else
      raise ArgumentError, "expected named AST pattern keys to be identifier-like strings"
    end
  end

  defp pattern_name(_name) do
    raise ArgumentError,
          "expected named AST pattern keys to be atoms or existing atom-name strings"
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

  defp match_payload(%{file: file, line: line, source: source} = match) do
    %Match{
      file: file,
      line: line,
      source: source,
      pattern: match_pattern(match),
      captures: match |> Map.get(:captures, %{}) |> render_captures()
    }
  end

  defp match_pattern(%{pattern: pattern}), do: to_string(pattern)
  defp match_pattern(_match), do: nil

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
      replaced = ex_ast_replace_all(source, pattern, replacement, opts)

      if source == replaced do
        []
      else
        [
          %Diff{
            file: file,
            diff: unified_diff(source, replaced, file),
            semantic_edits:
              semantic_edits(source, replaced, module_name(replaced) || module_name(source))
          }
        ]
      end
    end)
  end

  defp semantic_edits(old, new, module_name) do
    edits =
      old
      |> ExAST.diff(new, include_moves: false)
      |> Map.fetch!(:edits)

    edits
    |> high_signal_edits()
    |> Enum.map(&semantic_edit(&1, module_name))
  end

  defp high_signal_edits(edits) do
    structural = Enum.filter(edits, &(&1.kind in [:module, :function]))
    if structural == [], do: edits, else: structural
  end

  defp semantic_edit(edit, module_name) do
    range = edit.old_range || edit.new_range
    function = function_info(edit)

    %{
      op: edit.op,
      kind: edit.kind,
      summary: semantic_summary(edit, function, module_name),
      line: range_line(range),
      module: module_name,
      visibility: function && function.visibility,
      name: function && function.name,
      arity: function && function.arity
    }
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  defp semantic_summary(%{kind: :function} = edit, function, module_name) when is_map(function) do
    target = function_target(function, module_name)
    "#{op_verb(edit.op)} #{visibility_word(function.visibility)} #{target}"
  end

  defp semantic_summary(edit, _function, _module_name), do: edit.summary

  defp function_info(edit) do
    source = get_in(edit.meta, [:new]) || get_in(edit.meta, [:old])

    with source when is_binary(source) <- source,
         {:ok, ast} <- Code.string_to_quoted(source) do
      function_info_from_ast(ast)
    else
      _ -> nil
    end
  end

  defp function_info_from_ast({kind, _, [head | _]})
       when kind in [:def, :defp, :defmacro, :defmacrop] do
    {name, arity} = function_head_name_arity(head)

    if name do
      %{visibility: visibility(kind), name: name, arity: arity}
    end
  end

  defp function_info_from_ast(_ast), do: nil

  defp visibility(kind) when kind in [:def, :defmacro], do: :public
  defp visibility(kind) when kind in [:defp, :defmacrop], do: :private

  defp visibility_word(:public), do: "public"
  defp visibility_word(:private), do: "private"
  defp visibility_word(_), do: "function"

  defp function_target(%{name: name, arity: arity}, nil), do: "#{name}/#{arity}"

  defp function_target(%{name: name, arity: arity}, module_name),
    do: "#{module_name}.#{name}/#{arity}"

  defp op_verb(:insert), do: "added"
  defp op_verb(:delete), do: "removed"
  defp op_verb(:update), do: "changed"
  defp op_verb(:move), do: "moved"
  defp op_verb(op), do: to_string(op)

  defp function_head_name_arity({:when, _, [head | _guards]}), do: function_head_name_arity(head)

  defp function_head_name_arity({:\\, _, [head, _default]}), do: function_head_name_arity(head)

  defp function_head_name_arity({name, _, args}) when is_atom(name) and is_list(args),
    do: {name, length(args)}

  defp function_head_name_arity(_head), do: {nil, 0}

  defp range_line(nil), do: nil
  defp range_line(%{start: start}), do: start[:line]

  defp module_name(source) do
    with {:ok, ast} <- Code.string_to_quoted(source) do
      ast
      |> Macro.prewalk(nil, fn
        {:defmodule, _, [{:__aliases__, _, parts}, _]} = node, nil ->
          {node, Module.concat(parts) |> inspect()}

        node, acc ->
          {node, acc}
      end)
      |> elem(1)
    else
      _ -> nil
    end
  end

  defp semantic_diff_summary(0, _files), do: "Elixir syntax diff: no AST changes"

  defp semantic_diff_summary(total, files) do
    "Elixir syntax diff: #{total} edit(s) in #{length(files)} file(s)"
  end

  defp semantic_file_diff(path) do
    git_path = git_tracked_path(path) || path
    old = git_show("HEAD:#{git_path}") || ""
    new = read_worktree_file(path) || ""

    module_name = module_name(new) || module_name(old)

    %{
      file: path,
      module: module_name,
      edits: semantic_edits(old, new, module_name)
    }
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  defp diff_paths(opts) do
    cond do
      path = Keyword.get(opts, :path) -> path |> List.wrap() |> Enum.flat_map(&resolve_paths/1)
      Keyword.get(opts, :changed, false) -> changed_elixir_paths()
      true -> []
    end
    |> Enum.filter(&String.ends_with?(&1, [".ex", ".exs"]))
    |> Enum.uniq()
    |> Enum.sort()
  end

  defp changed_elixir_paths do
    diff_names = git_lines(["diff", "--name-only", "HEAD", "--", "*.ex", "*.exs"])
    untracked = git_lines(["ls-files", "--others", "--exclude-standard", "--", "*.ex", "*.exs"])
    diff_names ++ untracked
  end

  defp read_worktree_file(path) do
    cond do
      File.exists?(path) -> File.read!(path)
      root = git_root() -> root |> Path.join(path) |> maybe_read_file()
      true -> nil
    end
  end

  defp maybe_read_file(path) do
    if File.exists?(path), do: File.read!(path)
  end

  defp git_root do
    case System.cmd("git", ["rev-parse", "--show-toplevel"], stderr_to_stdout: true) do
      {output, 0} -> String.trim(output)
      _ -> nil
    end
  rescue
    _ in ErlangError -> nil
  end

  defp git_lines(args) do
    case System.cmd("git", args, stderr_to_stdout: true) do
      {output, 0} -> String.split(output, "\n", trim: true)
      _ -> []
    end
  rescue
    _ in ErlangError -> []
  end

  defp git_tracked_path(path) do
    case System.cmd("git", ["ls-files", "--full-name", "--", path], stderr_to_stdout: true) do
      {output, 0} -> output |> String.split("\n", trim: true) |> List.first()
      _ -> nil
    end
  rescue
    _ in ErlangError -> nil
  end

  defp git_show(revision) do
    case System.cmd("git", ["show", revision], stderr_to_stdout: true) do
      {output, 0} -> output
      _ -> nil
    end
  rescue
    _ in ErlangError -> nil
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

  defp diff_lines(old_lines, new_lines), do: diff_lines(old_lines, new_lines, [])

  defp diff_lines([], [], acc), do: acc |> Enum.reverse() |> List.flatten()

  defp diff_lines([old_line | old_rest], [new_line | new_rest], acc) do
    diff_lines(old_rest, new_rest, [diff_line(old_line, new_line) | acc])
  end

  defp diff_lines([], [new_line | new_rest], acc) do
    diff_lines([], new_rest, [diff_line(nil, new_line) | acc])
  end

  defp diff_lines([old_line | old_rest], [], acc) do
    diff_lines(old_rest, [], [diff_line(old_line, nil) | acc])
  end

  defp diff_line(nil, nil), do: []
  defp diff_line(line, line), do: [" ", line, "\n"]
  defp diff_line(nil, new_line), do: ["+", new_line, "\n"]
  defp diff_line(old_line, nil), do: ["-", old_line, "\n"]
  defp diff_line(old_line, new_line), do: ["-", old_line, "\n", "+", new_line, "\n"]

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

  defp ex_ast_search(paths, pattern, opts), do: apply(ExAST, :search, [paths, pattern, opts])

  defp ex_ast_search_many(paths, patterns, opts),
    do: apply(ExAST, :search_many, [paths, patterns, opts])

  defp ex_ast_replace(paths, pattern, replacement, opts),
    do: apply(ExAST, :replace, [paths, pattern, replacement, opts])

  defp ex_ast_replace_all(source, pattern, replacement, opts),
    do: apply(ExAST.Patcher, :replace_all, [source, pattern, replacement, opts])

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
