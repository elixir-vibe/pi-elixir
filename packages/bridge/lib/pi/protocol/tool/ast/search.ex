defmodule Pi.Protocol.Tool.AST.Search do
  @moduledoc "Structured AST search tool payload."

  use JSONCodec, fast_path: :json

  alias Pi.Protocol.Tool.AST.Match

  defstruct kind: "ast_search", pattern: nil, path: nil, matches: [], total: 0, display: nil

  @type t :: %__MODULE__{
          kind: String.t(),
          pattern: String.t(),
          path: String.t() | nil,
          matches: [Match.t()],
          total: non_neg_integer(),
          display: Pi.Protocol.UI.Display.t() | nil
        }
end
