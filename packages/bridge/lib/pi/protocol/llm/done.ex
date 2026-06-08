defmodule Pi.Protocol.LLM.Done do
  @moduledoc "Streaming LLM completion marker routed by request id."

  use JSONCodec, fast_path: :json, case: :camel

  defstruct [:type, :id, result: nil, usage: nil]

  @type t :: %__MODULE__{type: atom(), id: String.t(), result: term(), usage: map() | nil}

  codec(:type, atom: :existing)
end
