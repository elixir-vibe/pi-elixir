defmodule Pi.Protocol.Call do
  @moduledoc "Pi-to-BEAM tool call envelope."

  use JSONCodec, fast_path: :json

  defstruct [:type, :id, :name, arguments: %{}]

  @type t :: %__MODULE__{
          type: atom(),
          id: non_neg_integer(),
          name: String.t(),
          arguments: map()
        }

  codec(:type, atom: :existing)
end
