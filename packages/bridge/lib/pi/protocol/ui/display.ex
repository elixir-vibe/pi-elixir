defmodule Pi.Protocol.UI.Display do
  @moduledoc "Renderer-neutral tool display document."

  use JSONCodec, fast_path: :json

  alias Pi.Protocol.UI.Block

  defstruct kind: "display", title: nil, summary: nil, blocks: []

  @type t :: %__MODULE__{
          kind: String.t(),
          title: String.t() | nil,
          summary: String.t() | nil,
          blocks: [Block.t()]
        }
end
