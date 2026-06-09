defmodule Pi.Session do
  @moduledoc "Pi session APIs: host-session helpers plus server-owned BEAM sessions."

  alias Pi.LLM.Broker
  alias Pi.Session.Supervisor, as: SessionSupervisor
  alias Pi.Session.Worker

  @timeout 10_000

  @doc "Starts a server-owned BEAM session process."
  def start(opts \\ []) when is_list(opts), do: SessionSupervisor.start_session(opts)

  @doc "Looks up an active BEAM session by id."
  def lookup(id) when is_binary(id) do
    SessionSupervisor.workers()
    |> Enum.find_value(fn pid ->
      state = Worker.state(pid)
      if state.id == id, do: {:ok, pid}
    end)
    |> case do
      nil -> {:error, :not_found}
      result -> result
    end
  end

  @doc "Returns all active BEAM session states."
  def list do
    SessionSupervisor.workers()
    |> Enum.map(&Worker.state/1)
  end

  @doc "Returns one BEAM session state."
  def state(session), do: session |> resolve!() |> Worker.state()

  @doc "Subscribes the caller to semantic state updates from a BEAM session."
  def subscribe(session, pid \\ self()), do: session |> resolve!() |> Worker.subscribe(pid)

  @doc "Detaches the caller from semantic state updates from a BEAM session."
  def detach(session, pid \\ self()), do: session |> resolve!() |> Worker.detach(pid)

  @doc "Runs a prompt through a BEAM session's LLM backend."
  def run(session, prompt, opts \\ []) when is_binary(prompt) do
    session |> resolve!() |> Worker.run(prompt, opts)
  end

  @doc "Completes the current BEAM session messages through its LLM backend."
  def complete(session, opts \\ []) do
    session |> resolve!() |> Worker.complete(opts)
  end

  @doc "Creates a child BEAM session linked to a parent session id."
  def child(parent, opts \\ []) do
    parent_state = state(parent)
    start(Keyword.put_new(opts, :parent_id, parent_state.id))
  end

  @doc "Cancels active work in a BEAM session."
  def cancel(session), do: session |> resolve!() |> Worker.cancel()

  @doc "Returns compact project/runtime metadata from the active pi host session."
  def info(opts \\ []) do
    request(:session_info, %{}, opts)
  end

  @doc "Returns active model-facing tools from the active pi host session."
  def active_tools(opts \\ []) do
    request(:active_tools, %{}, opts)
  end

  @doc "Appends a custom entry to the active pi host session."
  def append_entry(custom_type, data \\ %{}, opts \\ [])
      when is_binary(custom_type) and is_map(data) do
    request(:append_entry, %{customType: custom_type, data: data}, opts)
  end

  defp resolve!(pid) when is_pid(pid), do: pid

  defp resolve!(id) when is_binary(id) do
    case lookup(id) do
      {:ok, pid} -> pid
      {:error, :not_found} -> raise ArgumentError, "unknown Pi session: #{id}"
    end
  end

  defp request(op, payload, opts) do
    timeout = Keyword.get(opts, :timeout, @timeout)
    Broker.request(op, payload, timeout)
  end
end
