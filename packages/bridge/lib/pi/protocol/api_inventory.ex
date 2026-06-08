defmodule Pi.Protocol.APIInventory do
  @moduledoc "Runtime and extension API inventory in bridge startup info."

  use JSONCodec, fast_path: :json

  alias Pi.Protocol.APIModule
  alias Pi.Protocol.ExtensionAPI

  defstruct runtime: [], extensions: []

  @type t :: %__MODULE__{runtime: [APIModule.t()], extensions: [ExtensionAPI.t()]}
end
