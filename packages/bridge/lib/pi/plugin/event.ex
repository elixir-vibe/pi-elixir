defmodule Pi.Plugin.Event do
  @moduledoc "Pi-side events delivered to BEAM plugins."

  use GenServer

  def start_link(opts \\ []), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  def install do
    case Process.whereis(__MODULE__) do
      nil -> start_link([])
      _pid -> :ok
    end
  end

  def push(event) when is_map(event) do
    install()
    GenServer.cast(__MODULE__, {:event, event})
  end

  def recent(n \\ 50), do: GenServer.call(__MODULE__, {:recent, n})
  def clear, do: GenServer.call(__MODULE__, :clear)

  @impl true
  def init(_opts), do: {:ok, :queue.new()}

  @impl true
  def handle_cast({:event, event}, events) do
    events = :queue.in(event, events)
    events = if :queue.len(events) > 256, do: elem(:queue.out(events), 1), else: events
    {:noreply, events}
  end

  @impl true
  def handle_call({:recent, n}, _from, events) do
    {:reply, events |> :queue.to_list() |> Enum.take(-n), events}
  end

  def handle_call(:clear, _from, _events), do: {:reply, :ok, :queue.new()}
end
