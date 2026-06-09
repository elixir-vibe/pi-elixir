defmodule Pi.Protocol.Tool.Eval do
  @moduledoc "Structured project eval tool payload."

  use JSONCodec, fast_path: :json

  defstruct kind: "eval", io: "", result: nil, error: nil, text: ""

  @type t :: %__MODULE__{
          kind: String.t(),
          io: String.t(),
          result: String.t() | nil,
          error: String.t() | nil,
          text: String.t()
        }
end
