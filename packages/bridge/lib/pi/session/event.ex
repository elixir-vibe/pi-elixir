defmodule Pi.Session.Event do
  @moduledoc "Structured event emitted by a server-owned Pi session process."

  @enforce_keys [:type, :at]
  defstruct [:type, :at, :data]

  @type type ::
          :started
          | :llm
          | :message
          | :done
          | :failed
          | :cancelled
          | :agent_job_started
          | :agent_job_finished
  @type t :: %__MODULE__{type: type(), at: DateTime.t(), data: term()}

  def new(type, data \\ nil) when is_atom(type) do
    %__MODULE__{type: type, at: DateTime.utc_now(), data: data}
  end
end
