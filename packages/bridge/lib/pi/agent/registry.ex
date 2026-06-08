defmodule Pi.Agent.Registry do
  @moduledoc "Tracks logical Pi agent sessions and message history."

  use GenServer

  alias Pi.Agent.Session

  def start_link(opts \\ []), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  def install do
    case Process.whereis(__MODULE__) do
      nil -> start_link([])
      _pid -> :ok
    end
  end

  def put(%Session{} = session) do
    install()
    GenServer.call(__MODULE__, {:put, session})
  end

  def append(session_id, message) when is_binary(session_id) do
    install()
    GenServer.call(__MODULE__, {:append, session_id, message})
  end

  def sessions do
    install()
    GenServer.call(__MODULE__, :sessions)
  end

  def children(%Session{id: id}), do: children(id)

  def children(parent_id) when is_binary(parent_id) do
    install()
    GenServer.call(__MODULE__, {:children, parent_id})
  end

  def history(%Session{id: id}), do: history(id)

  def history(session_id) when is_binary(session_id) do
    install()
    GenServer.call(__MODULE__, {:history, session_id})
  end

  @impl true
  def init(_opts), do: {:ok, %{sessions: %{}, history: %{}}}

  @impl true
  def handle_call({:put, session}, _from, state) do
    sessions = Map.put(state.sessions, session.id, session)
    history = Map.put_new(state.history, session.id, session.messages)
    {:reply, session, %{state | sessions: sessions, history: history}}
  end

  def handle_call({:append, session_id, message}, _from, state) do
    history = Map.update(state.history, session_id, [message], &(&1 ++ [message]))
    {:reply, :ok, %{state | history: history}}
  end

  def handle_call(:sessions, _from, state) do
    {:reply, Map.values(state.sessions), state}
  end

  def handle_call({:children, parent_id}, _from, state) do
    children =
      state.sessions
      |> Enum.filter(fn {_id, session} -> session.parent_id == parent_id end)
      |> Enum.map(fn {_id, session} -> session end)

    {:reply, children, state}
  end

  def handle_call({:history, session_id}, _from, state) do
    {:reply, Map.get(state.history, session_id, []), state}
  end
end
