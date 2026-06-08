defmodule Pi.Protocol.API.Module do
  @moduledoc "A module exposed as part of the Pi API inventory."

  use JSONCodec, fast_path: :json

  alias Pi.Protocol.API.Function

  defstruct [:name, :module, functions: []]

  @type t :: %__MODULE__{name: atom(), module: atom(), functions: [Function.t()]}

  codec(:name, atom: :unsafe)
  codec(:module, atom: :unsafe)
end
