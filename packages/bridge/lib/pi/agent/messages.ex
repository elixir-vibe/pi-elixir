defmodule Pi.Agent.Messages do
  @moduledoc "Message normalization helpers for agent session history."

  alias Pi.Protocol.LLM.Message

  def normalize(%Message{} = message), do: message
  def normalize(%{} = message), do: Message.from_map!(message)
  def normalize(message) when is_binary(message), do: %Message{role: :user, content: message}
end
