defmodule Pi.Agent.Step do
  @moduledoc "Declarative Pi agent orchestration step."

  alias Pi.Agent.Session

  defstruct [:name, :system, :prompt, :messages, :parent_id, metadata: %{}]

  @type t :: %__MODULE__{
          name: atom() | String.t() | nil,
          system: String.t() | nil,
          prompt: String.t() | nil,
          messages: [map()] | nil,
          parent_id: String.t() | nil,
          metadata: map()
        }

  def from(%__MODULE__{} = step), do: step
  def from(prompt) when is_binary(prompt), do: %__MODULE__{prompt: prompt}

  def from(%Session{} = session),
    do: %__MODULE__{
      name: session.name,
      system: session.system,
      messages: session.messages,
      parent_id: session.parent_id,
      metadata: session.metadata
    }

  def from(opts) when is_list(opts) do
    %__MODULE__{
      name: Keyword.get(opts, :name),
      system: Keyword.get(opts, :system),
      prompt: Keyword.get(opts, :prompt),
      messages: Keyword.get(opts, :messages),
      parent_id: Keyword.get(opts, :parent_id),
      metadata: Keyword.get(opts, :metadata, %{})
    }
  end

  def to_session(step, opts \\ [])

  def to_session(%__MODULE__{prompt: prompt} = step, opts) when is_binary(prompt) do
    Pi.Agent.session(prompt,
      name: step.name || Keyword.get(opts, :name),
      system: step.system || Keyword.get(opts, :system),
      parent_id: step.parent_id || Keyword.get(opts, :parent_id),
      metadata: Map.merge(step.metadata, Keyword.get(opts, :metadata, %{}))
    )
  end

  def to_session(%__MODULE__{} = step, opts) do
    Pi.Agent.session(
      name: step.name || Keyword.get(opts, :name),
      system: step.system || Keyword.get(opts, :system),
      messages: step.messages || Keyword.get(opts, :messages, []),
      parent_id: step.parent_id || Keyword.get(opts, :parent_id),
      metadata: Map.merge(step.metadata, Keyword.get(opts, :metadata, %{}))
    )
  end
end
