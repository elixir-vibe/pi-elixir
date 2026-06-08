defmodule Pi.Protocol.Ready do
  @moduledoc "BEAM-to-Pi ready event emitted by stdio startup."

  use JSONCodec, fast_path: :json

  alias Pi.Protocol.BridgeInfo

  defstruct [:type, :info]

  @type t :: %__MODULE__{type: atom(), info: BridgeInfo.t()}

  codec(:type, atom: :existing)
end
