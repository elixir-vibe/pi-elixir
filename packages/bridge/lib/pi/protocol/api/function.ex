defmodule Pi.Protocol.API.Function do
  @moduledoc "A BEAM function exposed as part of the Pi API inventory."

  use JSONCodec, fast_path: :json

  defstruct [:name, :arity]

  @type t :: %__MODULE__{name: atom(), arity: non_neg_integer()}

  codec(:name, atom: :unsafe)
end
