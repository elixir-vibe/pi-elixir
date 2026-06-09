defmodule Pi.Protocol.Session.Event do
  @moduledoc "Renderer-neutral session event snapshot."

  use JSONCodec, fast_path: :json

  defstruct [:type, :at, data: nil]

  @type t :: %__MODULE__{type: String.t(), at: String.t() | nil, data: term()}
end
