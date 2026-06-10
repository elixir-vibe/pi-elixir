defmodule Pi do
  @moduledoc "Small eval-friendly helpers for pi-elixir."

  @doc "Returns compact project/runtime metadata."
  def project, do: Pi.Project.info()

  @doc "Returns bounded captured logs from the embedded server logger."
  def logs(opts \\ []), do: Pi.LogCapture.get_logs(Keyword.get(opts, :tail, 50), opts)

  @doc "Clears embedded server logs."
  def clear_logs, do: Pi.LogCapture.clear_logs()

  @doc "Returns docs/source query helpers. Prefer calling `Pi.Docs` directly in pipelines."
  def docs, do: Pi.Docs

  @doc "Converts a value to pi-native structured output when possible."
  def output(value, opts \\ []), do: Pi.Output.output(value, opts)

  @doc "Renders rows as a pi-native table when returned from eval."
  def table(rows, opts \\ []), do: Pi.Output.table(rows, opts)

  @doc "Renders a nested value as a pi-native tree when returned from eval."
  def tree(value, opts \\ []), do: Pi.Output.tree(value, opts)

  @doc "Renders source code with syntax highlighting when returned from eval."
  def code(source, language \\ :elixir, opts \\ []), do: Pi.Output.code(source, language, opts)

  @doc "Renders plain text when returned from eval."
  def text(text, opts \\ []), do: Pi.Output.text(text, opts)
end
