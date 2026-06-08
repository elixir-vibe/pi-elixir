defmodule Pi.Protocol.UIEvent do
  @moduledoc "BEAM-to-Pi UI event envelope."

  use JSONCodec, fast_path: :json

  defstruct [
    :type,
    :op,
    :key,
    :text,
    :title,
    :current,
    :total,
    :lines,
    :placement,
    :message,
    :level
  ]

  @type t :: %__MODULE__{
          type: atom(),
          op: atom(),
          key: atom() | String.t() | nil,
          text: String.t() | nil,
          title: String.t() | nil,
          current: non_neg_integer() | nil,
          total: non_neg_integer() | nil,
          lines: [String.t()] | nil,
          placement: atom() | nil,
          message: String.t() | nil,
          level: atom() | nil
        }

  codec(:type, atom: :existing)
  codec(:op, atom: :existing)
  codec(:key, atom: :unsafe)
  codec(:placement, atom: :existing)
  codec(:level, atom: :existing)
end
