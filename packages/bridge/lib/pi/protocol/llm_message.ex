defmodule Pi.Protocol.LLMMessage do
  @moduledoc "LLM message passed across the Pi bridge."

  use JSONCodec, fast_path: :json

  defstruct [:role, :content]

  @type t :: %__MODULE__{role: atom(), content: String.t()}

  codec(:role, atom: :existing)
end
