defmodule Pi.LLM.Stream do
  @moduledoc "A multiplexed LLM stream handle."

  @enforce_keys [:id, :stream]
  defstruct [:id, :stream]

  @type t :: %__MODULE__{id: String.t(), stream: Enumerable.t()}
end
