defmodule Pi.Agent do
  @moduledoc "Unified BEAM abstraction for top-level agents and child agents."

  alias Pi.Agent.Job
  alias Pi.Agent.Manager
  alias Pi.Agent.Result
  alias Pi.Agent.Run
  alias Pi.Agent.Step
  alias Pi.Protocol.LLM.Message
  alias Pi.Session, as: RuntimeSession
  alias Pi.Session.State

  def run(prompt_or_opts, opts \\ []) do
    session = session(prompt_or_opts, opts)

    with {:ok, runtime} <- start_runtime_session(session, opts) do
      complete_runtime(runtime, session, opts)
    end
  end

  def run!(prompt_or_opts, opts \\ []) do
    case run(prompt_or_opts, opts) do
      {:ok, result} -> result
      {:error, %Result{error: reason}} -> raise RuntimeError, message: inspect(reason)
    end
  end

  def start(task, opts \\ []) when is_binary(task), do: Manager.start_job(task, opts)

  def jobs, do: Manager.jobs()

  def status(%Job{id: id}), do: status(id)
  def status(id) when is_binary(id), do: Manager.status(id)

  def result(%Job{id: id}), do: result(id)
  def result(id) when is_binary(id), do: Manager.result(id)

  def cancel(%Job{id: id}), do: cancel(id)
  def cancel(id) when is_binary(id), do: Manager.cancel(id)

  def run_many(specs, opts \\ []) when is_list(specs) do
    jobs = Enum.map(specs, &start_job_spec(&1, opts))

    case Enum.find(jobs, &match?({:error, _reason}, &1)) do
      nil -> {:ok, Enum.map(jobs, fn {:ok, job} -> job end)}
      error -> error
    end
  end

  def async(prompt_or_opts, opts \\ []) do
    Task.async(fn -> run(prompt_or_opts, opts) end)
  end

  def await(task_or_job_or_id, timeout \\ 60_000)
  def await(%Task{} = task, timeout), do: Task.await(task, timeout)
  def await(%Job{id: id}, timeout), do: await(id, timeout)
  def await(id, timeout) when is_binary(id), do: await_job(id, deadline(timeout))

  def await_many(tasks, timeout \\ 60_000) do
    Enum.map(tasks, &await(&1, timeout))
  end

  def parallel(runs, opts \\ []) when is_list(runs) do
    {:ok, parent} = RuntimeSession.start(name: Keyword.get(opts, :name, :parallel))
    timeout = Keyword.get(opts, :timeout, 60_000)

    results =
      runs
      |> Enum.with_index(1)
      |> Enum.map(fn {run, index} ->
        Task.async(fn -> run_child(parent, run, child_opts(run, opts, index)) end)
      end)
      |> await_many(timeout + 1_000)

    if Enum.all?(results, &match?({:ok, %Result{}}, &1)) do
      {:ok, Run.ok(:parallel, Enum.map(results, fn {:ok, result} -> result end))}
    else
      {:error, Run.error(:parallel, results, :one_or_more_failed)}
    end
  end

  def fanout(inputs, opts \\ []) when is_list(inputs), do: parallel(inputs, opts)

  def chain(steps, opts \\ []) when is_list(steps) do
    case reduce_chain(steps, opts, nil, []) do
      {:ok, results} -> {:ok, Run.ok(:chain, Enum.reverse(results))}
      {:error, results, reason} -> {:error, Run.error(:chain, Enum.reverse(results), reason)}
    end
  end

  def child(%State{} = parent, opts \\ []), do: State.child(parent, opts)

  def sessions, do: RuntimeSession.list()

  def children(%State{id: id}), do: children(id)

  def children(parent_id) when is_binary(parent_id) do
    RuntimeSession.list()
    |> Enum.filter(&(&1.parent_id == parent_id))
  end

  def history(%State{id: id, messages: fallback}), do: history(id, fallback)
  def history(session_id) when is_binary(session_id), do: history(session_id, [])

  def session(prompt_or_opts, opts \\ [])

  def session(%Step{} = step, opts), do: Step.to_session(step, opts)

  def session(prompt, opts) when is_binary(prompt) do
    opts
    |> Keyword.put(:messages, [%Message{role: :user, content: prompt}])
    |> State.new()
  end

  def session(opts, extra_opts) when is_list(opts) do
    opts
    |> Keyword.merge(extra_opts)
    |> State.new()
  end

  def session(%State{} = session, _opts), do: session

  defp start_job_spec(task, opts) when is_binary(task), do: start(task, opts)

  defp start_job_spec(%{task: task} = spec, opts) when is_binary(task) do
    start(task, Keyword.merge(opts, Map.to_list(Map.delete(spec, :task))))
  end

  defp start_job_spec(spec, _opts), do: {:error, {:invalid_job_spec, spec}}

  defp await_job(id, deadline) do
    case status(id) do
      {:ok, %Job{status: :running}} ->
        if System.monotonic_time(:millisecond) >= deadline do
          {:error, :timeout}
        else
          Process.sleep(25)
          await_job(id, deadline)
        end

      {:ok, %Job{status: :done} = job} ->
        {:ok, job}

      {:ok, %Job{status: status} = job} when status in [:failed, :cancelled] ->
        {:error, job}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp deadline(timeout), do: System.monotonic_time(:millisecond) + timeout

  defp child_opts(run, opts, index) do
    opts = Keyword.delete(opts, :name)

    if child_has_name?(run) do
      opts
    else
      Keyword.put(opts, :name, child_name(run, index))
    end
  end

  defp child_has_name?(run) when is_list(run), do: Keyword.has_key?(run, :name)
  defp child_has_name?(_run), do: false

  defp child_name(prompt, _index) when is_binary(prompt) do
    prompt
    |> String.replace(~r/\s+/u, " ")
    |> String.trim()
    |> String.slice(0, 40)
  end

  defp child_name(_run, index), do: "child #{index}"

  defp run_child(parent, prompt_or_opts, opts) do
    session = session(prompt_or_opts, opts)

    with {:ok, runtime} <- start_runtime_child(parent, session, opts) do
      complete_runtime(runtime, session, opts)
    end
  end

  defp complete_runtime(runtime, %State{} = session, opts) do
    case RuntimeSession.complete(runtime, Keyword.put(opts, :agent, session.id)) do
      {:ok, result} -> {:ok, Result.ok(session, result)}
      {:error, reason} -> {:error, Result.error(session, reason)}
    end
  end

  defp start_runtime_session(%State{} = session, opts) do
    RuntimeSession.start(
      id: session.id,
      parent_id: session.parent_id,
      name: session.name,
      system: session.system,
      messages: session.messages,
      metadata: Map.merge(session.metadata, Map.new(Keyword.get(opts, :metadata, %{})))
    )
  end

  defp start_runtime_child(parent, %State{} = session, opts) do
    RuntimeSession.child(parent,
      id: session.id,
      name: session.name,
      system: session.system,
      messages: session.messages,
      metadata: Map.merge(session.metadata, Map.new(Keyword.get(opts, :metadata, %{})))
    )
  end

  defp history(session_id, fallback) do
    case RuntimeSession.lookup(session_id) do
      {:ok, pid} -> RuntimeSession.state(pid).messages
      {:error, :not_found} -> fallback
    end
  end

  defp reduce_chain([], _opts, _previous, results), do: {:ok, results}

  defp reduce_chain([step | steps], opts, previous, results) do
    input = chain_input(step, previous)

    case run(input, opts) do
      {:ok, %Result{result: result} = agent_result} ->
        reduce_chain(steps, opts, result, [agent_result | results])

      {:error, reason} ->
        {:error, results, reason}
    end
  end

  defp chain_input(step, nil), do: step

  defp chain_input(step, previous) when is_binary(step),
    do: step <> "\n\nPrevious result:\n" <> inspect(previous)

  defp chain_input(step, previous) when is_list(step) do
    Keyword.update(
      step,
      :messages,
      [%Message{role: :user, content: inspect(previous)}],
      fn messages ->
        messages ++ [%Message{role: :user, content: inspect(previous)}]
      end
    )
  end
end
