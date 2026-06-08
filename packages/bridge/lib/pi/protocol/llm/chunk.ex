defmodule Pi.Protocol.LLM.Chunk do
  @moduledoc "Streaming LLM content chunk routed by request id."

  use JSONCodec, fast_path: :json, case: :camel

  @type_atom :llm_chunk

  defstruct [:type, :id, :delta]

  @type t :: %__MODULE__{type: atom(), id: String.t(), delta: String.t()}

  codec(:type, atom: :existing)

  def type_atom, do: @type_atom
end
