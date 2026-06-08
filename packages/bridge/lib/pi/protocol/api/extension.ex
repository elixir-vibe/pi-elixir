defmodule Pi.Protocol.API.Extension do
  @moduledoc "Plugin or skill API exposed to pi as an extension API."

  use JSONCodec, fast_path: :json

  alias Pi.Plugin.API

  defstruct [:name, :module, :alias, description: "", examples: []]

  @type t :: %__MODULE__{
          name: atom(),
          module: module(),
          alias: atom() | nil,
          description: String.t(),
          examples: [String.t()]
        }

  codec(:name, atom: :unsafe)
  codec(:module, atom: :unsafe)
  codec(:alias, atom: :unsafe)

  def from_api(%API{} = api) do
    %__MODULE__{
      name: api.name,
      module: api.module,
      alias: api.alias,
      description: api.description,
      examples: api.examples
    }
  end
end
