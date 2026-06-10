defmodule Pi.Protocol.Tool.OutputPart do
  @moduledoc "Semantic output part for tool renderers."

  use JSONCodec, fast_path: :json

  defstruct [:format, output: "", language: nil, preview: nil, truncation: nil, metadata: nil]

  @type format :: :text | :inspect | :markdown | :source | :error | :diff | :table | :tree
  @type truncation :: :head | :tail | nil

  @type t :: %__MODULE__{
          format: format(),
          output: String.t(),
          language: String.t() | nil,
          preview: String.t() | nil,
          truncation: truncation(),
          metadata: map() | nil
        }

  codec(:format,
    atom: {:enum, [:text, :inspect, :markdown, :source, :error, :diff, :table, :tree]}
  )

  codec(:truncation, atom: {:enum, [:head, :tail]})
end
