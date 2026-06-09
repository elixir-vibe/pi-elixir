defmodule Pi.Protocol.Tool.AST.Diff do
  @moduledoc "Textual replacement diff preview for an AST rewrite."

  use JSONCodec, fast_path: :json

  defstruct [:file, diff: "", language: "diff"]

  @type t :: %__MODULE__{file: String.t(), diff: String.t(), language: String.t()}
end
