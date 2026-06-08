defmodule Pi.Protocol.SkillInfo do
  @moduledoc "Executable skill shown in bridge startup info."

  use JSONCodec, fast_path: :json

  alias Pi.Protocol.API.Extension

  defstruct [:name, :path, :module, metadata: %{}, markdown: "", apis: []]

  @type t :: %__MODULE__{
          name: String.t() | nil,
          path: String.t() | nil,
          module: module() | nil,
          metadata: map(),
          markdown: String.t(),
          apis: [Extension.t()]
        }

  codec(:module, atom: :unsafe)
end
