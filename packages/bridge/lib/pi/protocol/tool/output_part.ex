defmodule Pi.Protocol.Tool.OutputPart do
  @moduledoc "Semantic output part for tool renderers."

  use JSONCodec, fast_path: :json

  defstruct [:format, output: "", language: nil, preview: nil, truncation: nil]

  @type format :: :text | :inspect | :markdown | :source | :error | :diff
  @type truncation :: :head | :tail | nil

  @type t :: %__MODULE__{
          format: format(),
          output: String.t(),
          language: String.t() | nil,
          preview: String.t() | nil,
          truncation: truncation()
        }

  codec(:format, atom: {:enum, [:text, :inspect, :markdown, :source, :error, :diff]})
  codec(:truncation, atom: {:enum, [:head, :tail]})
end
