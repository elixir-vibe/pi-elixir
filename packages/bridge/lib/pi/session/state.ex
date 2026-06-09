defmodule Pi.Session.State do
  @moduledoc "Semantic state owned by a Pi session process."

  alias Pi.Protocol.LLM.Message
  alias Pi.Session.Event

  @enforce_keys [:id]
  defstruct [
    :id,
    :parent_id,
    :name,
    :system,
    :status,
    :result,
    :error,
    started_at: nil,
    updated_at: nil,
    messages: [],
    events: [],
    metadata: %{}
  ]

  @type status :: :idle | :running | :done | :failed | :cancelled
  @type t :: %__MODULE__{
          id: String.t(),
          parent_id: String.t() | nil,
          name: atom() | String.t() | nil,
          system: String.t() | nil,
          status: status(),
          result: term(),
          error: term(),
          started_at: DateTime.t() | nil,
          updated_at: DateTime.t() | nil,
          messages: [Message.t()],
          events: [Event.t()],
          metadata: map()
        }

  def new(opts \\ []) do
    now = DateTime.utc_now()

    %__MODULE__{
      id: Keyword.get_lazy(opts, :id, &id/0),
      parent_id: Keyword.get(opts, :parent_id),
      name: Keyword.get(opts, :name),
      system: Keyword.get(opts, :system),
      status: Keyword.get(opts, :status, :idle),
      started_at: now,
      updated_at: now,
      messages: opts |> Keyword.get(:messages, []) |> Enum.map(&Pi.Agent.Messages.normalize/1),
      metadata: Keyword.get(opts, :metadata, %{})
    }
  end

  def child(%__MODULE__{} = parent, opts \\ []) do
    opts
    |> Keyword.put_new(:parent_id, parent.id)
    |> new()
  end

  defp id, do: "session_#{System.unique_integer([:positive])}"
end
