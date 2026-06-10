defprotocol Pi.Output.Renderable do
  @moduledoc "Converts eval-domain values into pi structured output when possible."

  @fallback_to_any true

  @doc "Returns a `Pi.Output` for `value`, or `nil` when the value has no semantic renderer."
  @spec to_output(term(), keyword()) :: Pi.Output.t() | nil
  def to_output(value, opts)
end

defimpl Pi.Output.Renderable, for: Pi.Output do
  def to_output(output, _opts), do: output
end

defimpl Pi.Output.Renderable, for: List do
  def to_output(value, opts), do: Pi.Output.list_output(value, opts)
end

defimpl Pi.Output.Renderable, for: Map do
  def to_output(value, opts), do: Pi.Output.map_output(value, opts)
end

defimpl Pi.Output.Renderable, for: BitString do
  def to_output(value, opts), do: Pi.Output.text(value, opts)
end

defimpl Pi.Output.Renderable, for: Pi.Docs.Result do
  def to_output(result, opts) do
    rows =
      Enum.map(result.entries, fn entry ->
        %{
          module: inspect(entry.module),
          kind: to_string(entry.kind),
          name: to_string(entry.name),
          arity: entry.arity,
          summary: entry.summary,
          source: entry.source,
          line: entry.line
        }
      end)

    Pi.Output.table(
      rows,
      Keyword.put_new(opts, :columns, [:module, :kind, :name, :arity, :summary, :line])
    )
  end
end

defimpl Pi.Output.Renderable, for: Pi.Docs.Entry do
  def to_output(entry, opts) do
    entry
    |> Map.from_struct()
    |> Map.update!(:module, &inspect/1)
    |> Pi.Output.tree(opts)
  end
end

defimpl Pi.Output.Renderable, for: Pi.Docs.Source do
  def to_output(source, opts) do
    Pi.Output.code(source.text, Keyword.get(opts, :language, :elixir),
      preview: Keyword.get(opts, :preview, source.subject)
    )
  end
end

defimpl Pi.Output.Renderable, for: Any do
  def to_output(_value, _opts), do: nil
end
