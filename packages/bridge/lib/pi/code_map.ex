defmodule Pi.CodeMap.FunctionRef do
  @moduledoc "A resolved function in a Reach project."
  use JSONCodec

  defstruct [:target, :mfa, :file, :line, :kind, clauses: []]

  @type t :: %__MODULE__{
          target: String.t() | nil,
          mfa: term(),
          file: String.t() | nil,
          line: non_neg_integer() | nil,
          kind: atom() | nil,
          clauses: [term()]
        }
end

defmodule Pi.CodeMap.Hotspot do
  @moduledoc "A Reach hotspot finding for a function."
  use JSONCodec

  defstruct [
    :display_function,
    :module,
    :function,
    :file,
    :line,
    :score,
    :branches,
    :callers,
    clauses: []
  ]

  @type t :: %__MODULE__{
          display_function: String.t() | nil,
          module: String.t() | nil,
          function: String.t() | nil,
          file: String.t() | nil,
          line: non_neg_integer() | nil,
          score: number() | nil,
          branches: non_neg_integer() | nil,
          callers: non_neg_integer() | nil,
          clauses: [term()]
        }
end

defmodule Pi.CodeMap.Boundary do
  @moduledoc "A mixed-effect boundary candidate."
  use JSONCodec

  defstruct [:display_function, :module, :function, :file, :line, effects: [], calls: []]

  @type t :: %__MODULE__{
          display_function: String.t() | nil,
          module: String.t() | nil,
          function: String.t() | nil,
          file: String.t() | nil,
          line: non_neg_integer() | nil,
          effects: [String.t()],
          calls: [map()]
        }
end

defmodule Pi.CodeMap.Smell do
  @moduledoc "A Reach smell finding normalized for eval."
  use JSONCodec

  defstruct [:kind, :message, :file, :line, :raw]

  @type t :: %__MODULE__{
          kind: String.t() | nil,
          message: String.t() | nil,
          file: String.t() | nil,
          line: non_neg_integer() | nil,
          raw: map() | nil
        }
end

defmodule Pi.CodeMap.Reflection do
  @moduledoc "Post-edit semantic reflection result."
  use JSONCodec

  defstruct command: "Pi.CodeMap.reflect",
            paths: [],
            changed_functions: [],
            summary: %{},
            hotspots: [],
            boundaries: [],
            smells: [],
            contexts: [],
            recommendation: nil

  @type t :: %__MODULE__{
          command: String.t(),
          paths: [String.t()],
          changed_functions: [Pi.CodeMap.FunctionRef.t()],
          summary: map(),
          hotspots: [Pi.CodeMap.Hotspot.t()],
          boundaries: [Pi.CodeMap.Boundary.t()],
          smells: [Pi.CodeMap.Smell.t()],
          contexts: [map()],
          recommendation: String.t() | nil
        }
end

defmodule Pi.CodeMap do
  @moduledoc """
  Reach-backed semantic code map and reflection helpers for eval.

  `Pi.CodeMap` turns Reach's project graph APIs into compact eval workflows. It
  is intentionally evidence-oriented: use it after edits to ask what changed,
  what depends on it, and whether Reach sees hotspots/smells/refactor leads.

  Eval preloads `alias Pi.CodeMap, as: CodeMap`.
  """

  alias Pi.CodeMap.{Boundary, FunctionRef, Hotspot, Reflection, Smell}
  alias Pi.Protocol.Tool.OutputPart
  alias Reach.Check.Smells, as: ReachSmells
  alias Reach.Inspect.Context, as: ReachContext
  alias Reach.Inspect.Impact
  alias Reach.IR.Helpers, as: IRHelpers
  alias Reach.Map.Analysis, as: MapAnalysis
  alias Reach.Project.Query

  @default_top 10
  @default_depth 3
  @reflection_hotspot_top 8
  @reflection_smell_top 12

  @doc "Returns true when Reach is available in the current project BEAM."
  def available?, do: Code.ensure_loaded?(Reach.Project)

  @doc "Builds a Reach project graph for the current Mix project or selected paths."
  def project(opts \\ []) do
    ensure_reach!()

    cond do
      paths = opts[:paths] ->
        paths |> List.wrap() |> expand_paths() |> Reach.Project.from_sources(project_opts(opts))

      glob = opts[:glob] ->
        Reach.Project.from_glob(glob, project_opts(opts))

      path = opts[:path] ->
        path |> List.wrap() |> expand_paths() |> Reach.Project.from_sources(project_opts(opts))

      true ->
        Reach.Project.from_mix_project(project_opts(opts))
    end
  end

  @doc "Returns a project-wide Reach summary."
  def summary(opts \\ []) do
    project = Keyword.get_lazy(opts, :project, fn -> project(opts) end)
    MapAnalysis.summary(project, opts[:path]) |> normalize()
  end

  @doc "Returns module metrics."
  def modules(opts \\ []), do: section(:modules, opts)

  @doc "Returns high-risk functions ranked by Reach hotspot score."
  def hotspots(opts \\ []) do
    :hotspots
    |> raw_section(opts)
    |> Enum.map(&hotspot/1)
  end

  @doc "Returns module coupling and cycles."
  def coupling(opts \\ []), do: section(:coupling, opts)

  @doc "Returns effectful call summaries."
  def effects(opts \\ []), do: section(:effects, opts)

  @doc "Returns mixed-effect boundary candidates."
  def boundaries(opts \\ []) do
    :boundaries
    |> raw_section(opts)
    |> Enum.map(&boundary/1)
  end

  @doc "Returns dominator-depth metrics."
  def depth(opts \\ []), do: section(:depth, opts)

  @doc "Returns cross-function data-flow summary."
  def data_flow(opts \\ []), do: section(:data, opts)

  @doc "Resolves a target string, MFA, or file:line into a function summary."
  def find(target, opts \\ []) do
    project = Keyword.get_lazy(opts, :project, fn -> project(opts) end)

    with {:ok, _mfa, func} <- resolve(project, target) do
      function_summary(func)
    end
  end

  @doc "Returns callers for a target."
  def callers(target, opts \\ []) do
    project = Keyword.get_lazy(opts, :project, fn -> project(opts) end)
    depth = Keyword.get(opts, :depth, @default_depth)

    with {:ok, mfa, _func} <- resolve(project, target) do
      project
      |> Query.callers(mfa, depth)
      |> Enum.map(&Map.update!(&1, :id, fn id -> %{mfa: id, label: mfa_string(id)} end))
      |> normalize()
    end
  end

  @doc "Returns callees for a target."
  def callees(target, opts \\ []) do
    project = Keyword.get_lazy(opts, :project, fn -> project(opts) end)
    depth = Keyword.get(opts, :depth, @default_depth)

    with {:ok, mfa, _func} <- resolve(project, target) do
      project
      |> Query.callees(mfa, depth)
      |> normalize_call_tree()
    end
  end

  @doc "Returns an agent-readable context bundle for a target."
  def context(target, opts \\ []) do
    project = Keyword.get_lazy(opts, :project, fn -> project(opts) end)

    with {:error, _reason} <- function_context(project, target, opts),
         {:error, _reason} <- module_context(project, target, opts) do
      {:error, "Function or module not found: #{inspect(target)}"}
    end
  end

  @doc "Returns Reach impact analysis for a target."
  def impact(target, opts \\ []) do
    project = Keyword.get_lazy(opts, :project, fn -> project(opts) end)
    depth = Keyword.get(opts, :depth, @default_depth)

    with {:ok, mfa, _func} <- resolve(project, target) do
      project |> Impact.analyze(mfa, depth) |> normalize()
    end
  end

  @doc "Returns Reach smell findings, optionally filtered by `:path`."
  def smells(opts \\ []) do
    project = Keyword.get_lazy(opts, :project, fn -> project(opts) end)
    path = opts[:path]

    project
    |> ReachSmells.run([])
    |> Enum.map(&smell/1)
    |> filter_by_path(path)
    |> Enum.take(opts[:top] || @default_top)
  end

  @doc "Runs a post-edit semantic reflection."
  def reflect(opts \\ []) do
    project = Keyword.get_lazy(opts, :project, fn -> project(opts) end)
    paths = reflection_paths(opts)
    changed = changed_functions(project, paths)
    changed_targets = Enum.map(changed, & &1.target)

    hotspots = reflection_hotspots(project, paths, changed_targets, opts)
    boundaries = reflection_boundaries(project, paths, opts)
    smells = reflection_smells(project, paths, opts)
    contexts = reflection_contexts(project, changed, opts)

    %Reflection{
      paths: paths,
      changed_functions: changed,
      summary: summary(project: project),
      hotspots: hotspots,
      boundaries: boundaries,
      smells: smells,
      contexts: contexts,
      recommendation: recommendation(changed, hotspots, boundaries, smells)
    }
  end

  @doc "Renders `reflect/1` as a compact tree output."
  def reflect_output(opts \\ []), do: reflect(opts) |> Pi.output(opts)

  defp section(key, opts), do: key |> raw_section(opts) |> normalize()

  defp raw_section(key, opts) do
    project = Keyword.get_lazy(opts, :project, fn -> project(opts) end)
    MapAnalysis.section_data(project, key, opts_with_top(opts), opts[:path])
  end

  defp opts_with_top(opts), do: Keyword.put_new(opts, :top, @default_top)
  defp project_opts(opts), do: Keyword.take(opts, [:plugins, :source_only])

  defp expand_paths(paths) do
    paths
    |> List.wrap()
    |> Enum.flat_map(fn path ->
      cond do
        File.dir?(path) -> Path.wildcard(Path.join(path, "**/*.{ex,erl,gleam,js,ts}"))
        String.contains?(path, "*") -> Path.wildcard(path)
        true -> [path]
      end
    end)
    |> Enum.filter(&File.regular?/1)
    |> Enum.uniq()
    |> Enum.sort()
  end

  defp function_context(project, target, opts) do
    with {:ok, mfa, func} <- resolve(project, target) do
      project
      |> ReachContext.build(mfa, func, opts)
      |> normalize()
    end
  end

  defp resolve(project, target) do
    mfa = if Query.mfa?(target), do: target, else: Query.resolve_target(project, target)

    with mfa when not is_nil(mfa) <- mfa,
         func when not is_nil(func) <- Query.find_function(project, mfa) do
      {:ok, mfa, func}
    else
      _ -> {:error, "Function not found: #{inspect(target)}"}
    end
  end

  defp module_context(project, target, opts) do
    with name when is_binary(name) <- module_name(target),
         metric when not is_nil(metric) <- module_metric(project, target, name, opts) do
      file = metric["file"]

      %{
        kind: :module,
        target: name,
        module: metric,
        functions: module_functions(project, target, name),
        hotspots: hotspots(project: project, path: file, top: opts[:top] || @default_top),
        boundaries: boundaries(project: project, path: file, top: opts[:top] || @default_top),
        smells: smells(project: project, path: file, top: opts[:smell_top] || @default_top)
      }
      |> normalize()
    else
      _ -> {:error, "Module not found: #{inspect(target)}"}
    end
  end

  defp module_name(module) when is_atom(module), do: module |> Atom.to_string() |> module_name()
  defp module_name(module) when is_binary(module), do: String.trim_leading(module, "Elixir.")
  defp module_name(_target), do: nil

  defp module_metric(project, target, module_name, opts) do
    reach_metric =
      project
      |> MapAnalysis.section_data(:modules, Keyword.put(opts, :top, 10_000), opts[:path])
      |> normalize()
      |> Enum.find(&(field(&1, "name") == module_name))

    reach_metric || loaded_module_metric(target, module_name)
  end

  defp loaded_module_metric(target, module_name) do
    with module when is_atom(module) <- loaded_module(target),
         true <- Code.ensure_loaded?(module) do
      functions = module.__info__(:functions)
      macros = module.__info__(:macros)
      file = module.module_info(:compile)[:source]

      %{
        "name" => module_name,
        "file" => file && List.to_string(file),
        "functions" => length(functions) + length(macros),
        "public" => length(functions),
        "public_count" => length(functions),
        "macro_count" => length(macros)
      }
    else
      _ -> nil
    end
  end

  defp loaded_module(module) when is_atom(module), do: module

  defp loaded_module(module) when is_binary(module) do
    with name when is_binary(name) <- module_name(module) do
      Module.concat([name])
    end
  rescue
    ArgumentError -> nil
  end

  defp loaded_module(_target), do: nil

  defp module_functions(project, target, module_name) do
    reach_functions =
      project.nodes
      |> Enum.map(fn {_id, node} -> node end)
      |> Enum.filter(&(function_def?(&1) and module_name(&1.meta[:module]) == module_name))
      |> Enum.map(&function_summary/1)

    (reach_functions ++ loaded_module_functions(target, module_name))
    |> Enum.uniq_by(& &1.target)
    |> Enum.sort_by(&{&1.file || "", &1.line || 0, &1.target || ""})
  end

  defp loaded_module_functions(target, module_name) do
    with module when is_atom(module) <- loaded_module(target),
         true <- Code.ensure_loaded?(module) do
      for {name, arity} <- module.__info__(:functions) ++ module.__info__(:macros) do
        %FunctionRef{target: "#{module_name}.#{name}/#{arity}", mfa: {module, name, arity}}
      end
    else
      _ -> []
    end
  end

  defp function_def?(node), do: node.type == :function_def

  defp reflection_paths(opts) do
    cond do
      opts[:paths] -> opts[:paths] |> List.wrap() |> Enum.map(&to_string/1)
      opts[:path] -> [to_string(opts[:path])]
      opts[:changed] == false -> []
      true -> changed_files()
    end
    |> Enum.filter(&String.match?(&1, ~r/\.(ex|erl|gleam|js|ts)$/))
    |> Enum.uniq()
    |> Enum.sort()
  end

  defp changed_files do
    {unstaged, _} = System.cmd("git", ["diff", "--name-only"], stderr_to_stdout: true)
    {staged, _} = System.cmd("git", ["diff", "--cached", "--name-only"], stderr_to_stdout: true)

    {untracked, _} =
      System.cmd("git", ["ls-files", "--others", "--exclude-standard"], stderr_to_stdout: true)

    (String.split(unstaged, "\n", trim: true) ++
       String.split(staged, "\n", trim: true) ++ String.split(untracked, "\n", trim: true))
    |> Enum.uniq()
  rescue
    _ in ErlangError -> []
  end

  defp changed_functions(_project, []), do: []

  defp changed_functions(project, paths) do
    paths
    |> Enum.flat_map(&changed_functions_for_path(project, &1))
    |> Enum.uniq_by(& &1.target)
    |> Enum.sort_by(&{&1.file || "", &1.line || 0})
  end

  defp changed_functions_for_path(project, path) do
    case changed_line_ranges(path) do
      [] ->
        functions_in_file(project, path)

      ranges ->
        ranges
        |> Enum.map(fn {line, _count} -> Query.find_function_at_location(project, path, line) end)
        |> Enum.reject(&is_nil/1)
        |> Enum.map(&function_summary/1)
    end
  end

  defp functions_in_file(project, path) do
    for {_id, node} <- project.nodes,
        (node.type == :function_def and node.source_span) &&
          Query.file_matches?(node.source_span.file, path),
        do: function_summary(node)
  end

  defp changed_line_ranges(path) do
    case System.cmd("git", ["diff", "--unified=0", "--", path], stderr_to_stdout: true) do
      {diff, 0} -> parse_hunks(diff)
      {diff, _} -> parse_hunks(diff)
    end
  rescue
    _ in ErlangError -> []
  end

  defp parse_hunks(diff) do
    ~r/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/m
    |> Regex.scan(diff)
    |> Enum.map(fn
      [_match, start] -> {String.to_integer(start), 1}
      [_match, start, ""] -> {String.to_integer(start), 1}
      [_match, start, count] -> {String.to_integer(start), String.to_integer(count)}
    end)
  end

  defp function_summary(func) do
    mfa = {func.meta[:module], func.meta[:name], func.meta[:arity]}

    %FunctionRef{
      target: mfa_string(mfa),
      mfa: mfa,
      file: func.source_span && func.source_span.file,
      line: func.source_span && func.source_span.start_line,
      kind: func.meta[:kind],
      clauses: clause_labels(func)
    }
  end

  defp reflection_hotspots(project, paths, changed_targets, opts) do
    path_hotspots =
      paths
      |> Enum.flat_map(fn path ->
        raw_section(:hotspots,
          project: project,
          path: path,
          top: opts[:top] || @reflection_hotspot_top
        )
      end)

    changed_hotspots =
      Enum.filter(path_hotspots, &(field(&1, :display_function) in changed_targets))

    (changed_hotspots ++ path_hotspots)
    |> Enum.uniq()
    |> Enum.take(opts[:top] || @reflection_hotspot_top)
    |> Enum.map(&hotspot/1)
  end

  defp reflection_boundaries(project, paths, opts) do
    paths
    |> Enum.flat_map(fn path ->
      raw_section(:boundaries,
        project: project,
        path: path,
        top: opts[:top] || @reflection_hotspot_top
      )
    end)
    |> Enum.take(opts[:top] || @reflection_hotspot_top)
    |> Enum.map(&boundary/1)
  end

  defp reflection_smells(project, [], opts),
    do: smells(project: project, top: opts[:smell_top] || @reflection_smell_top)

  defp reflection_smells(project, paths, opts) do
    paths
    |> Enum.flat_map(fn path ->
      smells(project: project, path: path, top: opts[:smell_top] || @reflection_smell_top)
    end)
    |> Enum.uniq()
    |> Enum.take(opts[:smell_top] || @reflection_smell_top)
  end

  defp reflection_contexts(project, changed, opts) do
    changed
    |> Enum.take(opts[:context_top] || 5)
    |> Enum.map(fn %FunctionRef{mfa: mfa} ->
      context(mfa, project: project, depth: opts[:depth] || 2)
    end)
  end

  defp recommendation([], [], [], []) do
    "No changed functions or Reach review leads detected. If edits were non-code or generated, no follow-up refactor is suggested."
  end

  defp recommendation(_changed, [], [], []) do
    "Changed functions have no Reach hotspots, mixed-effect boundaries, or smell findings in the inspected scope. Prefer stopping unless human review spots a naming/API issue."
  end

  defp recommendation(_changed, hotspots, boundaries, smells) do
    leads = []
    leads = if hotspots == [], do: leads, else: ["hotspots" | leads]
    leads = if boundaries == [], do: leads, else: ["mixed-effect boundaries" | leads]
    leads = if smells == [], do: leads, else: ["smells" | leads]

    "Review #{Enum.reverse(leads) |> Enum.join(", ")} before final. Apply one small behavior-preserving cleanup if it is in scope; otherwise document why it is deferred."
  end

  defp reflection_summary(%Reflection{} = reflection) do
    changed = length(reflection.changed_functions)
    hotspots = length(reflection.hotspots)
    boundaries = length(reflection.boundaries)
    smells = length(reflection.smells)
    leads = hotspots + boundaries + smells

    suffix = if leads == 0, do: "no Reach review leads", else: "review leads present"

    "Changed #{changed} · hotspots #{hotspots} · boundaries #{boundaries} · smells #{smells} · #{suffix}"
  end

  defp field(value, key) when is_struct(value), do: value |> Map.from_struct() |> Map.get(key)

  defp field(value, key) when is_map(value),
    do: Map.get(value, key) || Map.get(value, to_string(key))

  defp field(_value, _key), do: nil

  defp filter_by_path(findings, nil), do: findings

  defp filter_by_path(findings, path) do
    Enum.filter(findings, fn finding ->
      file = finding.file || get_in(finding.raw || %{}, ["source", "file"])
      is_binary(file) and Query.file_matches?(file, path)
    end)
  end

  defp hotspot(value), do: value |> JSONCodec.dump() |> Hotspot.from_map!()

  defp boundary(value), do: value |> JSONCodec.dump() |> Boundary.from_map!()

  defp smell(finding) do
    raw = normalize(finding)

    %{
      "kind" => raw["kind"] || raw["check"] || raw["name"],
      "message" => raw["message"] || raw["description"] || raw["trigger"],
      "file" => raw["file"] || raw["path"] || get_in(raw, ["source", "file"]),
      "line" => raw["line"] || get_in(raw, ["source", "line"]),
      "raw" => raw
    }
    |> Smell.from_map!()
  end

  defp normalize_call_tree(nodes) do
    Enum.map(nodes, fn node ->
      node
      |> Map.update!(:id, fn id -> %{mfa: id, label: mfa_string(id)} end)
      |> Map.update(:children, [], &normalize_call_tree/1)
    end)
    |> normalize()
  end

  defp clause_labels(func) do
    func.children
    |> Enum.filter(&(&1.type == :clause))
    |> Enum.map(fn clause -> clause.meta[:pattern] || clause.meta[:label] end)
    |> Enum.reject(&is_nil/1)
  end

  defp mfa_string({module, fun, arity}), do: IRHelpers.func_id_to_string({module, fun, arity})
  defp mfa_string(other), do: inspect(other)

  defp ensure_reach! do
    unless available?() do
      raise "Reach is not available. Add {:reach, \"~> 2.7\", only: [:dev, :test], runtime: false} to the project or use pi_bridge with Reach included."
    end
  end

  @doc false
  def reflection_output(%Reflection{} = reflection, opts \\ []) do
    plain = to_plain(reflection)
    tree = Pi.Output.tree(plain, opts)

    %Pi.Output{
      parts: [OutputPart.text(reflection_summary(reflection)) | tree.parts],
      text: inspect(plain)
    }
  end

  @doc false
  def to_plain(value), do: normalize(value)

  defp normalize(value) when is_struct(value), do: value |> Map.from_struct() |> normalize()

  defp normalize(value) when is_map(value),
    do: Map.new(value, fn {k, v} -> {normalize_key(k), normalize(v)} end)

  defp normalize(value) when is_list(value), do: Enum.map(value, &normalize/1)
  defp normalize(value) when is_tuple(value), do: inspect(value)
  defp normalize(value) when is_atom(value), do: inspect(value)
  defp normalize(value) when is_function(value), do: inspect(value)
  defp normalize(value) when is_pid(value), do: inspect(value)
  defp normalize(value) when is_reference(value), do: inspect(value)
  defp normalize(value) when is_port(value), do: inspect(value)
  defp normalize(value), do: value

  defp normalize_key(key) when is_atom(key), do: Atom.to_string(key)
  defp normalize_key(key), do: to_string(key)
end

defimpl Pi.Output.Renderable, for: Pi.CodeMap.Reflection do
  def to_output(reflection, opts), do: Pi.CodeMap.reflection_output(reflection, opts)
end

defimpl Pi.Output.Renderable, for: Pi.CodeMap.FunctionRef do
  def to_output(function_ref, opts),
    do: function_ref |> Pi.CodeMap.to_plain() |> Pi.Output.tree(opts)
end

defimpl Pi.Output.Renderable, for: Pi.CodeMap.Hotspot do
  def to_output(hotspot, opts), do: hotspot |> Pi.CodeMap.to_plain() |> Pi.Output.tree(opts)
end

defimpl Pi.Output.Renderable, for: Pi.CodeMap.Boundary do
  def to_output(boundary, opts), do: boundary |> Pi.CodeMap.to_plain() |> Pi.Output.tree(opts)
end

defimpl Pi.Output.Renderable, for: Pi.CodeMap.Smell do
  def to_output(smell, opts), do: smell |> Pi.CodeMap.to_plain() |> Pi.Output.tree(opts)
end
