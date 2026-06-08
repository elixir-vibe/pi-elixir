defmodule Pi.Protocol.LLMCancel do
  @moduledoc "BEAM-to-Pi LLM cancellation envelope."

  use JSONCodec, fast_path: :json, case: :camel

  defstruct [:type, :id, :reason]

  @type t :: %__MODULE__{type: atom(), id: String.t(), reason: String.t() | nil}

  codec(:type, atom: :existing)
end
