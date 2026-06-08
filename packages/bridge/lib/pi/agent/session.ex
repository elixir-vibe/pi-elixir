defmodule Pi.Agent.Session do
  @moduledoc "Logical Pi agent session. Child sessions model subagents."

  @enforce_keys [:id]
  defstruct [:id, :parent_id, :name, :system, messages: [], metadata: %{}]

  def new(opts \\ []) do
    %__MODULE__{
      id: Keyword.get_lazy(opts, :id, &id/0),
      parent_id: Keyword.get(opts, :parent_id),
      name: Keyword.get(opts, :name),
      system: Keyword.get(opts, :system),
      messages: Keyword.get(opts, :messages, []),
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
