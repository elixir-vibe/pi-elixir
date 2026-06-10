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

defimpl Pi.Output.Renderable, for: Pi.Web.Result do
  def to_output(result, opts) do
    preview = Keyword.get(opts, :preview, preview(result))

    part =
      Pi.Protocol.Tool.OutputPart.document(result.text,
        language: language(result.format),
        title: preview,
        data: metadata(result)
      )

    %Pi.Output{parts: [part], text: result.text}
  end

  defp preview(result) do
    title = if result.title in [nil, ""], do: result.final_url || result.url, else: result.title
    status = result.status || "?"
    suffix = if result.truncated?, do: " · truncated", else: ""
    "Web fetch · #{status} · #{title}#{suffix}"
  end

  defp language(:json), do: :json
  defp language(:html), do: :html
  defp language(:markdown), do: :markdown
  defp language(_format), do: :text

  defp metadata(result) do
    %{
      document_kind: :web_fetch,
      url: result.url,
      final_url: result.final_url,
      status: result.status,
      content_type: result.content_type,
      format: result.format,
      title: result.title,
      size_bytes: result.size_bytes,
      total_chars: result.total_chars,
      truncated: result.truncated?,
      redirected: result.redirected?
    }
  end
end

defimpl Pi.Output.Renderable, for: Pi.Docs.Source do
  def to_output(source, opts) do
    Pi.Output.code(source.text, Keyword.get(opts, :language, :elixir),
      title: Keyword.get(opts, :title) || Keyword.get(opts, :preview, source.subject),
      data: %{
        source_path: source.source,
        start_line: source.start_line,
        end_line: source.end_line,
        subject: source.subject
      }
    )
  end
end

defimpl Pi.Output.Renderable, for: Any do
  def to_output(_value, _opts), do: nil
end
