defmodule Pi.Output do
  @moduledoc "Eval-friendly structured output helpers for pi renderers."

  alias Pi.Output.Renderable
  alias Pi.Protocol.Tool.OutputPart

  defstruct parts: [], text: nil

  @type t :: %__MODULE__{parts: [OutputPart.t()], text: String.t() | nil}

  @doc "Wraps rows as a structured table output."
  def table(rows, opts \\ []) when is_list(rows) do
    %{columns: columns, rows: row_values, types: types, alignments: alignments} =
      table_data(rows, opts)

    preview = Keyword.get(opts, :preview) || table_preview(length(row_values), length(columns))

    %__MODULE__{
      parts: [
        %OutputPart{
          format: :table,
          output:
            encode_output_payload(%{
              columns: columns,
              rows: row_values,
              total_rows: length(row_values),
              column_types: types,
              alignments: alignments
            }),
          preview: preview
        }
      ],
      text: inspect(rows, inspect_opts())
    }
  end

  @doc "Wraps any value as a tree output."
  def tree(value, opts \\ []) do
    preview = Keyword.get(opts, :preview) || tree_preview(value)

    %__MODULE__{
      parts: [
        %OutputPart{
          format: :tree,
          output: encode_output_payload(tree_value(value, 0, Keyword.get(opts, :depth, 4))),
          preview: preview
        }
      ],
      text: inspect(value, inspect_opts())
    }
  end

  @doc "Wraps source code for syntax-highlighted rendering."
  def code(source, language \\ :elixir, opts \\ []) when is_binary(source) do
    %__MODULE__{
      parts: [
        %OutputPart{
          format: :source,
          output: source,
          language: to_string(language),
          preview: Keyword.get(opts, :preview) || first_line(source),
          metadata: Keyword.get(opts, :metadata, %{})
        }
      ],
      text: source
    }
  end

  @doc "Wraps plain text output."
  def text(text, opts \\ []) when is_binary(text) do
    %__MODULE__{
      parts: [%OutputPart{format: :text, output: text, preview: Keyword.get(opts, :preview)}],
      text: text
    }
  end

  @doc "Converts a value to structured output when a renderer is available."
  def output(value, opts \\ []) do
    case Renderable.to_output(value, opts) do
      %__MODULE__{} = output -> output
      nil -> text(inspect(value, inspect_opts()), opts)
    end
  end

  @doc false
  def auto(value, opts \\ []), do: Renderable.to_output(value, opts)

  @doc false
  def parts_for(%__MODULE__{parts: parts}) when is_list(parts), do: parts

  def parts_for(value) do
    case auto(value) do
      %__MODULE__{parts: parts} -> parts
      nil -> nil
    end
  end

  @doc false
  def text_for(%__MODULE__{text: text}) when is_binary(text), do: text
  def text_for(_value), do: nil

  defp encode_output_payload(payload) do
    payload
    |> JSONCodec.dump()
    |> Jason.encode!()
  end

  defp table_data(rows, opts) do
    columns = Keyword.get(opts, :columns) || infer_columns(rows)
    column_strings = Enum.map(columns, &to_string/1)

    raw_values =
      Enum.map(rows, fn row ->
        Enum.map(columns, fn column -> raw_cell(row, column) end)
      end)

    row_values = Enum.map(raw_values, fn row -> Enum.map(row, &cell_text/1) end)

    %{
      columns: column_strings,
      rows: row_values,
      types: column_types(raw_values),
      alignments: column_alignments(raw_values)
    }
  end

  defp infer_columns(rows) do
    rows
    |> Enum.flat_map(fn
      row when is_map(row) -> Map.keys(row)
      row when is_list(row) -> Keyword.keys(row)
      _other -> []
    end)
    |> Enum.uniq()
    |> Enum.sort_by(&to_string/1)
  end

  defp raw_cell(row, column) when is_map(row) do
    Map.get(row, column, Map.get(row, to_string(column)))
  end

  defp raw_cell(row, column) when is_list(row), do: Keyword.get(row, column)
  defp raw_cell(_row, _column), do: nil

  defp cell_text(nil), do: ""
  defp cell_text(value) when is_binary(value), do: value

  defp cell_text(value) when is_atom(value) or is_number(value) or is_boolean(value),
    do: inspect(value)

  defp cell_text(value), do: inspect(value, inspect_opts())

  defp column_types(rows) do
    rows
    |> transpose()
    |> Enum.map(&column_type/1)
  end

  defp column_type(values) do
    values
    |> Enum.reject(&is_nil/1)
    |> Enum.map(&value_type/1)
    |> Enum.uniq()
    |> case do
      [] -> "empty"
      [type] -> type
      _types -> "mixed"
    end
  end

  defp value_type(value) when is_integer(value), do: "integer"
  defp value_type(value) when is_float(value), do: "float"
  defp value_type(value) when is_boolean(value), do: "boolean"
  defp value_type(value) when is_atom(value), do: "atom"
  defp value_type(value) when is_binary(value), do: "string"
  defp value_type(value) when is_list(value), do: "list"
  defp value_type(value) when is_map(value), do: "map"
  defp value_type(value) when is_tuple(value), do: "tuple"
  defp value_type(_value), do: "term"

  defp column_alignments(rows) do
    rows
    |> transpose()
    |> Enum.map(fn values ->
      if values |> Enum.reject(&is_nil/1) |> Enum.all?(&is_number/1), do: "right", else: "left"
    end)
  end

  defp transpose([]), do: []
  defp transpose(rows), do: rows |> Enum.zip() |> Enum.map(&Tuple.to_list/1)

  @doc false
  def list_output(value, opts) do
    if table_like?(value), do: table(value, opts), else: nil
  end

  @doc false
  def map_output(value, opts) do
    if map_size(value) > 0, do: tree(value, opts), else: nil
  end

  defp table_like?([first | _]) when is_map(first), do: true
  defp table_like?([first | _]) when is_list(first), do: Keyword.keyword?(first)
  defp table_like?(_other), do: false

  defp tree_value(value, depth, max_depth) when depth >= max_depth do
    inspect(value, inspect_opts())
  end

  defp tree_value(value, depth, max_depth) when is_map(value) do
    value
    |> Enum.map(fn {key, child} ->
      %{key: inspect(key), value: tree_value(child, depth + 1, max_depth)}
    end)
  end

  defp tree_value(value, depth, max_depth) when is_list(value) do
    value
    |> Enum.with_index()
    |> Enum.map(fn {child, index} ->
      %{key: Integer.to_string(index), value: tree_value(child, depth + 1, max_depth)}
    end)
  end

  defp tree_value(value, _depth, _max_depth), do: cell_text(value)

  defp table_preview(rows, columns), do: "#{rows} rows × #{columns} columns"
  defp tree_preview(value) when is_map(value), do: "map with #{map_size(value)} keys"
  defp tree_preview(value) when is_list(value), do: "list with #{length(value)} items"
  defp tree_preview(_value), do: "tree"

  defp first_line(source) do
    source
    |> String.split("\n", parts: 2)
    |> List.first()
    |> Kernel.||("")
  end

  defp inspect_opts, do: [charlists: :as_lists, limit: 50, pretty: true]
end
