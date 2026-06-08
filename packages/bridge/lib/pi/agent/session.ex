defmodule Pi.Agent.Session do
  @moduledoc "Logical Pi agent session. Child sessions model subagents."

  alias Pi.Agent.Messages
  alias Pi.Protocol.LLM.Message

  @enforce_keys [:id]
  defstruct [:id, :parent_id, :name, :system, messages: [], metadata: %{}]

  @type t :: %__MODULE__{
          id: String.t(),
          parent_id: String.t() | nil,
          name: atom() | String.t() | nil,
          system: String.t() | nil,
          messages: [Message.t()],
          metadata: map()
        }

  def new(opts \\ []) do
    %__MODULE__{
      id: Keyword.get_lazy(opts, :id, &id/0),
      parent_id: Keyword.get(opts, :parent_id),
      name: Keyword.get(opts, :name),
      system: Keyword.get(opts, :system),
      messages: opts |> Keyword.get(:messages, []) |> Enum.map(&Messages.normalize/1),
      metadata: Keyword.get(opts, :metadata, %{})
    }
  end

  def child(parent, opts \\ []) do
    opts
    |> Keyword.put_new(:parent_id, parent.id)
    |> new()
  end

  defp id, do: "agent_#{System.unique_integer([:positive])}"
end
