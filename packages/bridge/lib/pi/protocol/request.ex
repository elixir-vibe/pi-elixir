defmodule Pi.Protocol.Request do
  @moduledoc "BEAM-to-Pi multiplexed request envelope."

  use JSONCodec, fast_path: :json

  defstruct [:type, :id, :op, payload: %{}]

  @type t :: %__MODULE__{
          type: atom(),
          id: String.t(),
          op: atom(),
          payload: map()
        }

  codec(:type, atom: :existing)
  codec(:op, atom: :existing)
end
