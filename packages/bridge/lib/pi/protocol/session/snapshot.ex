defmodule Pi.Protocol.Session.Snapshot do
  @moduledoc "Renderer-neutral snapshot of a server-owned Pi session."

  use JSONCodec, fast_path: :json

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
    :duration_ms,
    :prompt,
    :response,
    :latest,
    message_count: 0,
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
          duration_ms: non_neg_integer() | nil,
          prompt: String.t() | nil,
          response: String.t() | nil,
          latest: String.t() | nil,
          message_count: non_neg_integer(),
          events: [Event.t()]
        }

  codec(:parent_id, as: "parentId")
  codec(:started_at, as: "startedAt")
  codec(:updated_at, as: "updatedAt")
  codec(:duration_ms, as: "durationMs")
  codec(:message_count, as: "messageCount")
end
