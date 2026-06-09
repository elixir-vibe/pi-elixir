defmodule Pi.Protocol.Tool.AST.ReplaceRequest do
  @moduledoc "Arguments for AST replacement."

  use JSONCodec, fast_path: :json

  defstruct [
    :pattern,
    :replacement,
    path: nil,
    inside: nil,
    not_inside: nil,
    allow_broad: false,
    limit: nil,
    dry_run: false
  ]

  @type t :: %__MODULE__{
          pattern: String.t(),
          replacement: String.t(),
          path: String.t() | nil,
          inside: String.t() | nil,
          not_inside: String.t() | nil,
          allow_broad: boolean(),
          limit: non_neg_integer() | nil,
          dry_run: boolean()
        }

  codec(:not_inside, as: "notInside")
  codec(:allow_broad, as: "allowBroad")
  codec(:dry_run, as: "dryRun")
end
