defmodule Pi.Protocol.Tool.AST.Replacement do
  @moduledoc "Structured AST replacement file payload."

  use JSONCodec, fast_path: :json

  defstruct [:file, :count]

  @type t :: %__MODULE__{file: String.t(), count: non_neg_integer()}
end
