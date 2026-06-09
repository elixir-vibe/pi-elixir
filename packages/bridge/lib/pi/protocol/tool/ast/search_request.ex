defmodule Pi.Protocol.Tool.AST.SearchRequest do
  @moduledoc "Arguments for AST search."

  use JSONCodec, fast_path: :json

  defstruct pattern: nil,
            patterns: nil,
            path: nil,
            inside: nil,
            not_inside: nil,
            allow_broad: false,
            limit: nil

  @type t :: %__MODULE__{
          pattern: String.t() | nil,
          patterns: %{String.t() => String.t()} | nil,
          path: String.t() | nil,
          inside: String.t() | nil,
          not_inside: String.t() | nil,
          allow_broad: boolean(),
          limit: non_neg_integer() | nil
        }

  codec(:not_inside, as: "notInside")
  codec(:allow_broad, as: "allowBroad")
end
