defmodule Pi.Protocol.LLM.Error do
  @moduledoc "Streaming LLM error routed by request id."

  use JSONCodec, fast_path: :json, case: :camel

  defstruct [:type, :id, :error]

  @type t :: %__MODULE__{type: atom(), id: String.t(), error: term()}

  codec(:type, atom: :existing)
end
