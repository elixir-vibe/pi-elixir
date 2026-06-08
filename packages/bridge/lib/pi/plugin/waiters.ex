defmodule Pi.Plugin.Waiters do
  @moduledoc "ETS-backed session waiter registry for interactive plugins."

  use GenServer

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  def install do
    case GenServer.whereis(__MODULE__) do
      nil -> GenServer.start_link(__MODULE__, [], name: __MODULE__)
      _pid -> :ok
    end
  end

  @impl true
  def init(_opts), do: {:ok, %{tables: MapSet.new()}}

  @impl true
  def handle_call({:ensure_table, table}, _from, state) do
    create_table(table)
    {:reply, :ok, %{state | tables: MapSet.put(state.tables, table)}}
  end

  def ensure_table!(table) when is_atom(table) do
    if table?(table) do
      :ok
    else
      ensure_owned_table!(table)
    end
  end

  def register(table, session_id, pid)
      when is_atom(table) and is_binary(session_id) and is_pid(pid) do
    ensure_table!(table)
    :ets.insert(table, {session_id, pid})
    :ok
  end

  def unregister(table, session_id) when is_atom(table) and is_binary(session_id) do
    if table?(table), do: :ets.delete(table, session_id)
    :ok
  end

  def pop(table, session_id) when is_atom(table) and is_binary(session_id) do
    if table?(table) do
      case :ets.lookup(table, session_id) do
        [{^session_id, pid}] ->
          :ets.delete(table, session_id)
          {:ok, pid}

        [] ->
          :error
      end
    else
      :error
    end
  end

  def table?(table) when is_atom(table), do: :ets.info(table) != :undefined

  defp ensure_owned_table!(table) do
    if Process.whereis(__MODULE__) do
      GenServer.call(__MODULE__, {:ensure_table, table})
    else
      raise "#{inspect(__MODULE__)} is not running"
    end
  end

  defp create_table(table) do
    case :ets.info(table) do
      :undefined -> :ets.new(table, [:named_table, :public, :set])
      _info -> table
    end
  end
end
