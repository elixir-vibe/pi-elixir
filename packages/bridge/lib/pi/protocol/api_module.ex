defmodule Pi.Protocol.APIModule do
  @moduledoc "A module exposed as part of the Pi API inventory."

  use JSONCodec, fast_path: :json

  alias Pi.Protocol.APIFunction

  defstruct [:name, :module, functions: []]

  @type t :: %__MODULE__{name: atom(), module: atom(), functions: [APIFunction.t()]}

  codec(:name, atom: :unsafe)
  codec(:module, atom: :unsafe)
end
