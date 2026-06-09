defmodule Pi.Eval.Supervisor do
  @moduledoc "Dynamic supervisor for stateful eval session evaluators."

  use DynamicSupervisor

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    DynamicSupervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @spec install() :: :ok | {:ok, pid()} | {:error, term()}
  def install do
    install_registry()

    case Process.whereis(__MODULE__) do
      nil ->
        case start_link([]) do
          {:ok, pid} ->
            Process.unlink(pid)
            {:ok, pid}

          other ->
            other
        end

      _pid ->
        :ok
    end
  end

  @spec evaluator(String.t(), keyword()) :: {:ok, pid()} | {:error, term()}
  def evaluator(session_id, opts \\ []) when is_binary(session_id) do
    install()

    case Registry.lookup(Pi.Eval.Registry, session_id) do
      [{pid, _value}] when is_pid(pid) ->
        {:ok, pid}

      [] ->
        child_spec = {Pi.Eval.Evaluator, Keyword.put(opts, :session_id, session_id)}
        DynamicSupervisor.start_child(__MODULE__, child_spec)
    end
  end

  @impl true
  def init(_opts), do: DynamicSupervisor.init(strategy: :one_for_one)

  defp install_registry do
    case Process.whereis(Pi.Eval.Registry) do
      nil ->
        case Registry.start_link(keys: :unique, name: Pi.Eval.Registry) do
          {:ok, pid} -> Process.unlink(pid)
          {:error, {:already_started, _pid}} -> :ok
          {:error, _reason} -> :ok
        end

      _pid ->
        :ok
    end
  end
end
