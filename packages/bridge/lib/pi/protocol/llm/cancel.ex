defmodule Pi.Protocol.LLM.Cancel do
  @moduledoc "BEAM-to-Pi LLM cancellation envelope."

  use JSONCodec, fast_path: :json, case: :camel

  @type_atom :llm_cancel

  defstruct [:type, :id, :reason]

  @type t :: %__MODULE__{type: atom(), id: String.t(), reason: String.t() | nil}

  codec(:type, atom: :existing)

  def type_atom, do: @type_atom
end
