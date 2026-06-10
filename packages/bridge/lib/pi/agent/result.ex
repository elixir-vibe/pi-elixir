defmodule Pi.Agent.Result do
  @moduledoc "Result of a Pi agent run."

  alias Pi.Session.State

  @enforce_keys [:session]
  defstruct [:session, :result, :error]

  @type t :: %__MODULE__{session: State.t(), result: term(), error: term()}

  def ok(%State{} = session, result), do: %__MODULE__{session: session, result: result}
  def error(%State{} = session, error), do: %__MODULE__{session: session, error: error}
end
