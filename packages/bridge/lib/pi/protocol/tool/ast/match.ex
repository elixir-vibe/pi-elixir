defmodule Pi.Protocol.Tool.AST.Match do
  @moduledoc "Structured AST search match payload."

  use JSONCodec, fast_path: :json

  defstruct [:file, :line, :source, :pattern, captures: %{}]

  @type t :: %__MODULE__{
          file: String.t(),
          line: pos_integer(),
          source: String.t(),
          pattern: String.t() | nil,
          captures: map()
        }
end
