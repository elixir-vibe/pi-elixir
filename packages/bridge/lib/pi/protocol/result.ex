defmodule Pi.Protocol.Result do
  @moduledoc "BEAM-to-Pi tool result envelope."

  use JSONCodec, fast_path: :json

  defstruct [:type, :id, text: "", is_error: false]

  @type t :: %__MODULE__{
          type: atom(),
          id: non_neg_integer(),
          text: String.t(),
          is_error: boolean()
        }

  codec(:type, atom: :existing)
  codec(:is_error, as: "isError")
end
