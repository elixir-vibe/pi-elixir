defmodule Pi.Docs do
  @moduledoc "Pipeline-friendly helpers for installed BEAM docs and source slices."

  defmodule Result do
    @moduledoc "A docs query result."
    defstruct modules: [], entries: []

    @type t :: %__MODULE__{modules: [module()], entries: [Pi.Docs.Entry.t()]}
  end

  defmodule Entry do
    @moduledoc "A single documented module/function/macro entry."
    defstruct [:module, :kind, :name, :arity, :signature, :summary, :doc, :source, :line]

    @type t :: %__MODULE__{
            module: module(),
            kind: atom(),
            name: atom(),
            arity: non_neg_integer() | nil,
            signature: String.t() | nil,
            summary: String.t(),
            doc: String.t(),
            source: String.t() | nil,
            line: pos_integer() | nil
          }
  end

  defmodule Source do
    @moduledoc "A source-code slice."
    defstruct [:module, :source, :start_line, :end_line, :text, :subject]

    @type t :: %__MODULE__{
            module: module() | nil,
            source: String.t() | nil,
            start_line: pos_integer(),
            end_line: pos_integer(),
            text: String.t(),
            subject: String.t()
          }
  end

  @doc "Loads docs for a module."
  @spec module(module()) :: Result.t()
  def module(module) when is_atom(module) do
    %Result{modules: [module], entries: module_entries(module)}
  end

  @doc "Loads docs for many modules."
  @spec modules([module()]) :: Result.t()
  def modules(modules) when is_list(modules) do
    modules = Enum.filter(modules, &is_atom/1)
    %Result{modules: modules, entries: Enum.flat_map(modules, &module_entries/1)}
  end

  @doc "Loads docs for currently loaded modules, optionally filtered by prefix."
  @spec loaded(keyword()) :: Result.t()
  def loaded(opts \\ []) do
    prefix = Keyword.get(opts, :prefix)

    :code.all_loaded()
    |> Enum.map(&elem(&1, 0))
    |> Enum.filter(&match_prefix?(&1, prefix))
    |> Enum.sort_by(&inspect/1)
    |> modules()
  end

  @doc "Keeps function and macro entries from a docs result or module."
  @spec functions(Result.t() | module()) :: Result.t()
  def functions(module) when is_atom(module), do: module |> __MODULE__.module() |> functions()

  def functions(%Result{} = result) do
    filter_entries(result, &(&1.kind in [:function, :macro]))
  end

  @doc "Finds one function or macro entry by name and arity."
  @spec function(Result.t() | module(), atom(), non_neg_integer()) :: Entry.t() | nil
  def function(queryable, name, arity) when is_atom(name) and is_integer(arity) do
    queryable
    |> result_entries()
    |> Enum.find(&(&1.name == name and &1.arity == arity and &1.kind in [:function, :macro]))
  end

  @doc "Searches docs entries by module/name/signature/summary/doc text."
  @spec search(Result.t() | module(), String.t()) :: Result.t()
  def search(queryable, query) when is_binary(query) do
    needle = String.downcase(query)
    result = ensure_result(queryable)
    filter_entries(result, &(entry_text(&1) |> String.downcase() |> String.contains?(needle)))
  end

  @doc "Returns source for a module, docs entry, or single-entry result."
  @spec source(module() | Entry.t() | Result.t(), keyword()) :: Source.t() | nil
  def source(queryable, opts \\ [])

  def source(%Entry{} = entry, opts) do
    with source when is_binary(source) <- entry.source,
         line when is_integer(line) <- entry.line do
      context = Keyword.get(opts, :context, 20)
      start_line = max(1, line - context)
      end_line = line + context
      source_slice(source, start_line..end_line, entry.module, entry_subject(entry))
    else
      _missing -> nil
    end
  end

  def source(%Result{entries: [entry]}, opts), do: source(entry, opts)
  def source(%Result{modules: [module]}, opts), do: source(module, opts)
  def source(%Result{}, _opts), do: nil

  def source(module, opts) when is_atom(module) do
    with source when is_binary(source) <- module_source(module),
         %Range{} = lines <- Keyword.get(opts, :lines, 1..80) do
      source_slice(source, lines, module, inspect(module))
    else
      _missing -> nil
    end
  end

  defp module_entries(module) do
    source = module_source(module)

    case Code.fetch_docs(module) do
      {:docs_v1, _anno, _beam_lang, _format, moduledoc, _metadata, docs} ->
        module_entry = module_entry(module, source, moduledoc)
        function_entries = Enum.map(docs, &doc_entry(module, source, &1))
        [module_entry | function_entries]

      _error ->
        []
    end
  end

  defp module_entry(module, source, moduledoc) do
    doc = doc_text(moduledoc)

    %Entry{
      module: module,
      kind: :module,
      name: module,
      arity: nil,
      signature: nil,
      summary: summary(doc),
      doc: doc,
      source: source,
      line: 1
    }
  end

  defp doc_entry(module, source, {{kind, name, arity}, anno, signature, doc, _metadata}) do
    doc = doc_text(doc)

    %Entry{
      module: module,
      kind: kind,
      name: name,
      arity: arity,
      signature: signature_text(signature),
      summary: summary(doc),
      doc: doc,
      source: source,
      line: doc_line(anno)
    }
  end

  defp doc_text(%{"en" => text}) when is_binary(text), do: text
  defp doc_text(:none), do: ""
  defp doc_text(:hidden), do: ""
  defp doc_text(_other), do: ""

  defp signature_text([signature | _]) when is_binary(signature), do: signature
  defp signature_text(_signature), do: nil

  defp doc_line(line) when is_integer(line), do: line
  defp doc_line(%{line: line}) when is_integer(line), do: line
  defp doc_line(_anno), do: nil

  defp summary(""), do: ""

  defp summary(doc) do
    doc
    |> String.split("\n", parts: 2)
    |> List.first()
    |> to_string()
  end

  defp filter_entries(%Result{} = result, fun) when is_function(fun, 1) do
    %{result | entries: Enum.filter(result.entries, fun)}
  end

  defp ensure_result(%Result{} = result), do: result
  defp ensure_result(module) when is_atom(module), do: __MODULE__.module(module)

  defp result_entries(%Result{entries: entries}), do: entries

  defp result_entries(module) when is_atom(module),
    do: module |> __MODULE__.module() |> result_entries()

  defp entry_text(%Entry{} = entry) do
    Enum.map_join(
      [
        inspect(entry.module),
        entry.kind,
        entry.name,
        entry.arity,
        entry.signature,
        entry.summary,
        entry.doc
      ],
      "\n",
      &to_string/1
    )
  end

  defp module_source(module) when is_atom(module) do
    if Code.ensure_loaded?(module) do
      module.module_info(:compile)[:source]
      |> case do
        nil -> nil
        source -> to_string(source)
      end
    end
  rescue
    _exception in [ArgumentError, UndefinedFunctionError] -> nil
  end

  defp source_slice(source, %Range{} = lines, module, subject) do
    first = Enum.min(lines)
    last = Enum.max(lines)

    selected =
      source
      |> File.stream!()
      |> Stream.with_index(1)
      |> Stream.filter(fn {_line, line_number} ->
        line_number >= first and line_number <= last
      end)
      |> Enum.map_join(&elem(&1, 0))

    %Source{
      module: module,
      source: source,
      start_line: first,
      end_line: last,
      text: selected,
      subject: "#{subject} lines #{first}-#{last}"
    }
  rescue
    _exception in [File.Error, RuntimeError] -> nil
  end

  defp entry_subject(%Entry{} = entry),
    do: "#{inspect(entry.module)}.#{entry.name}/#{entry.arity}"

  defp match_prefix?(_module, nil), do: true

  defp match_prefix?(module, prefix) when is_atom(prefix) do
    module_parts = Module.split(module)
    prefix_parts = Module.split(prefix)
    Enum.take(module_parts, length(prefix_parts)) == prefix_parts
  end

  defp match_prefix?(module, prefix) when is_binary(prefix) do
    module |> Module.split() |> Enum.join(".") |> String.starts_with?(prefix)
  end
end
