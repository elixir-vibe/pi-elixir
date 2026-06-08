defmodule Pi.Protocol.SkillInfo do
  @moduledoc "Executable skill shown in bridge startup info."

  use JSONCodec, fast_path: :json

  defstruct [:name, :path, :module]

  @type t :: %__MODULE__{
          name: String.t() | nil,
          path: String.t() | nil,
          module: String.t() | nil
        }
end
