defmodule Pi.Protocol.Tool.AST.Diff do
  @moduledoc "Textual and syntax-aware replacement diff preview for an AST rewrite."

  use JSONCodec, fast_path: :json

  defstruct [:file, diff: "", language: "diff", semantic_edits: []]

  @type semantic_edit :: %{
          op: atom(),
          kind: atom(),
          summary: String.t(),
          line: non_neg_integer() | nil
        }

  @type t :: %__MODULE__{
          file: String.t(),
          diff: String.t(),
          language: String.t(),
          semantic_edits: [semantic_edit()]
        }
end
