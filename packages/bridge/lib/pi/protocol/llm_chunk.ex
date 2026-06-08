defmodule Pi.Protocol.LLMChunk do
  @moduledoc "Streaming LLM content chunk routed by request id."

  use JSONCodec, fast_path: :json, case: :camel

  defstruct [:type, :id, :delta]

  @type t :: %__MODULE__{type: atom(), id: String.t(), delta: String.t()}

  codec(:type, atom: :existing)
end
