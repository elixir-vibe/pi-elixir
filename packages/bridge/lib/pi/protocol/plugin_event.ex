defmodule Pi.Protocol.PluginEvent do
  @moduledoc "BEAM-to-pi extension event-bus envelope."

  use JSONCodec, fast_path: :json

  defstruct [:type, :name, data: %{}]

  @type t :: %__MODULE__{
          type: atom(),
          name: String.t(),
          data: map()
        }

  codec(:type, atom: :existing)
end
