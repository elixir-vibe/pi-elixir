defmodule Pi.Protocol.Tool.Eval do
  @moduledoc "Structured project eval tool payload."

  use JSONCodec, fast_path: :json

  alias Pi.Protocol.Tool.OutputPart
  alias Pi.Protocol.UI.Display

  defstruct kind: "eval",
            io: "",
            result: nil,
            error: nil,
            exception: nil,
            text: "",
            parts: [],
            display: nil,
            bindings: [],
            state: nil

  @type t :: %__MODULE__{
          kind: String.t(),
          io: String.t(),
          result: String.t() | nil,
          error: String.t() | nil,
          exception: map() | nil,
          text: String.t(),
          parts: [OutputPart.t()],
          display: Display.t() | nil,
          bindings: [map()],
          state: map() | nil
        }
end
