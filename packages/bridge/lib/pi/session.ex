defmodule Pi.Session do
  @moduledoc "Pi session APIs: host-session helpers plus server-owned BEAM sessions."

  alias Pi.Session.Supervisor, as: SessionSupervisor
  alias Pi.Session.Worker

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

  @doc "Returns renderer-neutral snapshots for active BEAM sessions."
  def snapshots do
    SessionSupervisor.workers()
    |> Enum.map(&Worker.snapshot/1)
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

  @doc "Reruns a BEAM session from its latest user message."
  def rerun(session, opts \\ []), do: session |> resolve!() |> Worker.rerun(opts)

  @doc "Returns compact project/runtime metadata from the active pi host session. Prefer `Pi.Host.info/1`."
  defdelegate info(opts \\ []), to: Pi.Host

  @doc "Returns active model-facing tools from the active pi host session. Prefer `Pi.Host.active_tools/1`."
  defdelegate active_tools(opts \\ []), to: Pi.Host

  @doc "Appends a custom entry to the active pi host session. Prefer `Pi.Host.append_entry/3`."
  defdelegate append_entry(custom_type, data \\ %{}, opts \\ []), to: Pi.Host

  @doc "Sends a custom message entry to the active pi host session. Prefer `Pi.Host.send_message/3`."
  defdelegate send_message(custom_type, data \\ %{}, opts \\ []), to: Pi.Host

  defp resolve!(pid) when is_pid(pid), do: pid

  defp resolve!(id) when is_binary(id) do
    case lookup(id) do
      {:ok, pid} -> pid
      {:error, :not_found} -> raise ArgumentError, "unknown Pi session: #{id}"
    end
  end
end
