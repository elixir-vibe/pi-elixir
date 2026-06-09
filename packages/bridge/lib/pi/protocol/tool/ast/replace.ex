defmodule Pi.Protocol.Tool.AST.Replace do
  @moduledoc "Structured AST replace tool payload."

  use JSONCodec, fast_path: :json

  alias Pi.Protocol.Tool.AST.Replacement

  defstruct kind: "ast_replace",
            dry_run: false,
            pattern: nil,
            replacement: nil,
            path: nil,
            replacements: [],
            total: 0

  @type t :: %__MODULE__{
          kind: String.t(),
          dry_run: boolean(),
          pattern: String.t(),
          replacement: String.t(),
          path: String.t() | nil,
          replacements: [Replacement.t()],
          total: non_neg_integer()
        }
end
