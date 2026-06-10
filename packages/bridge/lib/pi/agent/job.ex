defmodule Pi.Agent.Job do
  @moduledoc "Supervised agent job lifecycle handle."

  use GenServer

  alias Pi.Agent.Manager
  alias Pi.Session, as: RuntimeSession
  alias Pi.Session.Event

  @enforce_keys [:id, :task, :child_session_id]
  defstruct [
    :id,
    :task,
    :role,
    :model,
    :parent_session_id,
    :child_session_id,
    :pid,
    :status,
    :result,
    :error,
    :started_at,
    :finished_at,
    :duration_ms
  ]

  @type status :: :running | :done | :failed | :cancelled

  @type t :: %__MODULE__{
          id: String.t(),
          task: String.t(),
          role: atom() | String.t() | nil,
          model: term(),
          parent_session_id: String.t() | nil,
          child_session_id: String.t(),
          pid: pid() | nil,
          status: status(),
          result: term(),
          error: term(),
          started_at: DateTime.t() | nil,
          finished_at: DateTime.t() | nil,
          duration_ms: non_neg_integer() | nil
        }

  @default_timeout 60_000

  def new(task, opts \\ []) when is_binary(task) do
    %__MODULE__{
      id: Keyword.get_lazy(opts, :id, &id/0),
      task: task,
      role: Keyword.get(opts, :role),
      model: Keyword.get(opts, :model),
      parent_session_id: Keyword.get(opts, :parent_session_id),
      child_session_id: Keyword.get_lazy(opts, :child_session_id, &session_id/0),
      status: :running,
      started_at: DateTime.utc_now()
    }
  end

  def start_link({%__MODULE__{} = job, opts}) do
    GenServer.start_link(__MODULE__, {job, opts})
  end

  def cancel(pid), do: GenServer.call(pid, :cancel)

  @impl true
  def init({job, opts}) do
    send(self(), :run)

    {:ok,
     %{
       job: job,
       opts: opts,
       session: nil,
       task: nil,
       task_ref: nil,
       started_at: System.monotonic_time(:millisecond)
     }}
  end

  @impl true
  def handle_info(:run, state) do
    case start_session(state.job, state.opts) do
      {:ok, session} ->
        {:ok, _session_state} = RuntimeSession.subscribe(session, self())
        emit_parent_event(state.job, :agent_job_started, job_data(state.job))
        timeout = Keyword.get(state.opts, :timeout, @default_timeout)

        task =
          Task.async(fn ->
            RuntimeSession.run(
              session,
              state.job.task,
              Keyword.put(state.opts, :timeout, timeout)
            )
          end)

        {:noreply, %{state | session: session, task: task, task_ref: task.ref}}

      {:error, reason} ->
        {:stop, :normal, finish(state, {:error, reason})}
    end
  end

  def handle_info({ref, {:ok, result}}, %{task_ref: ref} = state) do
    Process.demonitor(ref, [:flush])
    {:stop, :normal, finish(%{state | task: nil, task_ref: nil}, {:ok, result})}
  end

  def handle_info({ref, {:error, :cancelled}}, %{task_ref: ref} = state) do
    Process.demonitor(ref, [:flush])
    {:stop, :normal, finish(%{state | task: nil, task_ref: nil}, {:cancelled, :cancelled})}
  end

  def handle_info({ref, {:error, reason}}, %{task_ref: ref} = state) do
    Process.demonitor(ref, [:flush])
    {:stop, :normal, finish(%{state | task: nil, task_ref: nil}, {:error, reason})}
  end

  def handle_info({:DOWN, ref, :process, _pid, reason}, %{task_ref: ref} = state) do
    {:stop, :normal, finish(%{state | task: nil, task_ref: nil}, {:error, reason})}
  end

  def handle_info({:pi_session, _id, _session_state}, state), do: {:noreply, state}

  @impl true
  def handle_call(:cancel, _from, state) do
    if state.session, do: RuntimeSession.cancel(state.session)
    if state.task, do: Task.shutdown(state.task, :brutal_kill)

    job = finish(state, {:cancelled, :cancelled})
    {:stop, :normal, :ok, %{state | job: job}}
  end

  defp start_session(job, opts) do
    session_opts = [
      id: job.child_session_id,
      parent_id: job.parent_session_id,
      name: Keyword.get(opts, :name) || job.role || job.task,
      system: Keyword.get(opts, :system),
      messages: Keyword.get(opts, :messages, []),
      metadata:
        Map.merge(
          %{agent_job_id: job.id, agent_role: job.role},
          Map.new(Keyword.get(opts, :metadata, %{}))
        )
    ]

    RuntimeSession.start(session_opts)
  end

  defp finish(state, {:ok, result}) do
    complete_job(state, :done, result, nil)
  end

  defp finish(state, {:cancelled, reason}) do
    complete_job(state, :cancelled, nil, reason)
  end

  defp finish(state, {:error, reason}) do
    complete_job(state, :failed, nil, reason)
  end

  defp complete_job(state, status, result, error) do
    job = %{
      state.job
      | status: status,
        result: result,
        error: error,
        finished_at: DateTime.utc_now(),
        duration_ms: System.monotonic_time(:millisecond) - state.started_at
    }

    emit_parent_event(job, :agent_job_finished, job_data(job))
    Manager.job_finished(job)
    job
  end

  defp emit_parent_event(%{parent_session_id: nil}, _type, _data), do: :ok

  defp emit_parent_event(%{parent_session_id: parent_session_id}, type, data) do
    with {:ok, parent} <- RuntimeSession.lookup(parent_session_id) do
      RuntimeSession.emit_event(parent, Event.new(type, data))
    end

    :ok
  end

  defp job_data(job) do
    %{
      id: job.id,
      task: job.task,
      role: job.role,
      model: job.model,
      parent_session_id: job.parent_session_id,
      child_session_id: job.child_session_id,
      status: job.status,
      result: job.result,
      error: job.error,
      started_at: datetime(job.started_at),
      finished_at: datetime(job.finished_at),
      duration_ms: job.duration_ms
    }
  end

  defp datetime(nil), do: nil
  defp datetime(%DateTime{} = datetime), do: DateTime.to_iso8601(datetime)
  defp datetime(value), do: value

  defp id, do: "job_#{System.unique_integer([:positive])}"
  defp session_id, do: "session_#{System.unique_integer([:positive])}"
end
