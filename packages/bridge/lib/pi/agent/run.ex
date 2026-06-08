defmodule Pi.Agent.Run do
  @moduledoc "Structured result of an agent orchestration run."

  alias Pi.Agent.Result

  @enforce_keys [:kind, :results]
  defstruct [:kind, status: :ok, results: [], error: nil, metadata: %{}]

  @type kind :: :single | :parallel | :chain | :fanout
  @type status :: :ok | :error

  @type t :: %__MODULE__{
          kind: kind(),
          status: status(),
          results: [Result.t() | term()],
          error: term(),
          metadata: map()
        }

  def ok(kind, results, metadata \\ %{}) when is_list(results) do
    %__MODULE__{kind: kind, status: :ok, results: results, metadata: metadata}
  end

  def error(kind, results, error, metadata \\ %{}) when is_list(results) do
    %__MODULE__{kind: kind, status: :error, results: results, error: error, metadata: metadata}
  end
end
