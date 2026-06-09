defmodule Pi.Protocol.UI.Block do
  @moduledoc "Renderer-neutral semantic UI block."

  use JSONCodec, fast_path: :json

  defstruct [:type, text: "", language: nil, path: nil, line: nil]

  @type block_type :: :text | :inspect | :markdown | :source | :error | :diff | :location

  @type t :: %__MODULE__{
          type: block_type(),
          text: String.t(),
          language: String.t() | nil,
          path: String.t() | nil,
          line: non_neg_integer() | nil
        }

  codec(:type, atom: {:enum, [:text, :inspect, :markdown, :source, :error, :diff, :location]})
end
