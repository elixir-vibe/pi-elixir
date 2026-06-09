defmodule Pi.Protocol.Tool.EvalRequest do
  @moduledoc "Arguments for project eval tools."

  use JSONCodec, fast_path: :json

  defstruct [:code, :session_id, :state_path, :restore_path, timeout: nil, mode: :trusted]

  @type mode :: :trusted | :sandbox
  @type t :: %__MODULE__{
          code: String.t(),
          timeout: non_neg_integer() | nil,
          mode: mode(),
          session_id: String.t() | nil,
          state_path: String.t() | nil,
          restore_path: String.t() | nil
        }

  codec(:mode, atom: {:enum, [:trusted, :sandbox]})
  codec(:session_id, as: "sessionId")
  codec(:state_path, as: "statePath")
  codec(:restore_path, as: "restorePath")
end
