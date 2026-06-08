defmodule Pi.Agent.Result do
  @moduledoc "Result of a Pi agent run."

  alias Pi.Agent.Session

  @enforce_keys [:session]
  defstruct [:session, :result, :error]

  @type t :: %__MODULE__{session: Session.t(), result: term(), error: term()}

  def ok(%Session{} = session, result), do: %__MODULE__{session: session, result: result}
  def error(%Session{} = session, error), do: %__MODULE__{session: session, error: error}
end
