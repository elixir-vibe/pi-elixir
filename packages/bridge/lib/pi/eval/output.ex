defmodule Pi.Eval.Output do
  @moduledoc false

  alias Pi.Protocol.Tool.OutputPart
  alias Pi.Protocol.UI.Block
  alias Pi.Protocol.UI.Display

  @inspect_opts [charlists: :as_lists, limit: 50, pretty: true]
  @preview_inspect_opts [
    charlists: :as_lists,
    limit: 20,
    pretty: false,
    printable_limit: 200,
    width: 1_000_000
  ]

  def inspect_value(value), do: inspect(value, @inspect_opts)
  def preview(value), do: inspect(value, @preview_inspect_opts)

  def error_text(%{text: text}) when is_binary(text), do: text
  def error_text(text) when is_binary(text), do: text

  def error_exception(%{exception: exception}) when is_map(exception), do: exception
  def error_exception(_), do: nil

  def maybe_io_part(parts, ""), do: parts
  def maybe_io_part(parts, io), do: parts ++ [OutputPart.text(io)]

  def display(parts), do: %Display{blocks: Enum.map(parts, &part_block/1)}

  def capture_io(fun) do
    {:ok, pid} = StringIO.open("")
    original = Application.get_env(:elixir, :ansi_enabled)
    original_gl = Process.group_leader()
    Application.put_env(:elixir, :ansi_enabled, false)
    Process.group_leader(self(), pid)

    try do
      result = fun.()
      {_, content} = StringIO.contents(pid)
      {result, content}
    after
      Process.group_leader(self(), original_gl)
      StringIO.close(pid)
      Application.put_env(:elixir, :ansi_enabled, original)
    end
  end

  defp part_block(%OutputPart{} = part) do
    struct(Block, type: block_type(part.kind), text: part.body, language: part.language)
  end

  defp block_type(:code), do: :source
  defp block_type(kind), do: kind
end
