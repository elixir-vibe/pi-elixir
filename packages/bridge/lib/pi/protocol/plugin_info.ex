defmodule Pi.Protocol.PluginInfo do
  @moduledoc "Plugin shown in bridge startup info."

  use JSONCodec, fast_path: :json

  defstruct [:name, :module]

  @type t :: %__MODULE__{name: String.t() | nil, module: String.t() | nil}
end
