defmodule Pi.Protocol.Session.Snapshot do
  @moduledoc "Renderer-neutral snapshot of a server-owned Pi session."

  use JSONCodec, case: :camel, fast_path: :json

  alias Pi.Protocol.Session.Event

  defstruct [
    :id,
    :parent_id,
    :name,
    :status,
    :result,
    :error,
    :started_at,
    :updated_at,
    :completed_at,
    :duration_ms,
    :prompt,
    :response,
    :latest,
    :current,
    usage: nil,
    run_count: 0,
    message_count: 0,
    recent_output: [],
    events: []
  ]

  @type t :: %__MODULE__{
          id: String.t(),
          parent_id: String.t() | nil,
          name: String.t() | nil,
          status: String.t(),
          result: term(),
          error: String.t() | nil,
          started_at: String.t() | nil,
          updated_at: String.t() | nil,
          completed_at: String.t() | nil,
          duration_ms: non_neg_integer() | nil,
          prompt: String.t() | nil,
          response: String.t() | nil,
          latest: String.t() | nil,
          current: String.t() | nil,
          usage: map() | nil,
          run_count: non_neg_integer(),
          message_count: non_neg_integer(),
          recent_output: [String.t()],
          events: [Event.t()]
        }
end
