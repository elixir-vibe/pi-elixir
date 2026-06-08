defmodule Pi.Protocol.API.Inventory do
  @moduledoc "Runtime and extension API inventory in bridge startup info."

  use JSONCodec, fast_path: :json

  alias Pi.Protocol.API.Extension
  alias Pi.Protocol.API.Module, as: APIModule

  defstruct runtime: [], extensions: []

  @type t :: %__MODULE__{runtime: [APIModule.t()], extensions: [Extension.t()]}
end
