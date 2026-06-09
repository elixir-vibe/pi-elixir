defmodule Pi.Protocol.Tool.EvalRequest do
  @moduledoc "Arguments for project eval tools."

  use JSONCodec, fast_path: :json

  defstruct [:code, timeout: nil, mode: :trusted]

  @type mode :: :trusted | :sandbox
  @type t :: %__MODULE__{code: String.t(), timeout: non_neg_integer() | nil, mode: mode()}

  codec(:mode, atom: {:enum, [:trusted, :sandbox]})
end
