defmodule Pi.Protocol.Integration.Status do
  @moduledoc "Status badge emitted by an optional project integration."

  use JSONCodec, fast_path: :json

  defstruct [:key, :text]

  @type t :: %__MODULE__{key: atom() | String.t(), text: String.t()}

  codec(:key, atom: :unsafe)
end
