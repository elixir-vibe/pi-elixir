defmodule Pi.Agent do
  @moduledoc "Unified BEAM abstraction for top-level agents and child agents."

  alias Pi.Agent.Registry
  alias Pi.Agent.Result
  alias Pi.Agent.Run
  alias Pi.Agent.Session
  alias Pi.Agent.Step
  alias Pi.Protocol.LLM.Message
  alias Pi.Session, as: RuntimeSession

  def run(prompt_or_opts, opts \\ []) do
    session = prompt_or_opts |> session(opts) |> Registry.put()

    with {:ok, runtime} <- start_runtime_session(session, opts) do
      case RuntimeSession.complete(runtime, Keyword.put(opts, :agent, session.id)) do
        {:ok, result} ->
          Registry.append(session.id, %Message{role: :assistant, content: result})
          {:ok, Result.ok(session, result)}

        {:error, reason} ->
          {:error, Result.error(session, reason)}
      end
    end
  end

  def run!(prompt_or_opts, opts \\ []) do
    case run(prompt_or_opts, opts) do
      {:ok, result} -> result
      {:error, %Result{error: reason}} -> raise RuntimeError, message: inspect(reason)
    end
  end

  def async(prompt_or_opts, opts \\ []) do
    Task.async(fn -> run(prompt_or_opts, opts) end)
  end

  def await(task, timeout \\ 60_000), do: Task.await(task, timeout)

  def await_many(tasks, timeout \\ 60_000) do
    Enum.map(tasks, &await(&1, timeout))
  end

  def parallel(runs, opts \\ []) when is_list(runs) do
    {:ok, parent} = RuntimeSession.start(name: Keyword.get(opts, :name, :parallel))
    timeout = Keyword.get(opts, :timeout, 60_000)

    results =
      runs
      |> Enum.map(fn run -> Task.async(fn -> run_child(parent, run, opts) end) end)
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

  def child(%Session{} = parent, opts \\ []) do
    parent
    |> Session.child(opts)
    |> Registry.put()
  end

  def sessions, do: Registry.sessions()
  def children(parent), do: Registry.children(parent)
  def history(agent), do: Registry.history(agent)

  def session(prompt_or_opts, opts \\ [])

  def session(%Step{} = step, opts), do: Step.to_session(step, opts)

  def session(prompt, opts) when is_binary(prompt) do
    opts
    |> Keyword.put(:messages, [%Message{role: :user, content: prompt}])
    |> Session.new()
  end

  def session(opts, extra_opts) when is_list(opts) do
    opts
    |> Keyword.merge(extra_opts)
    |> Session.new()
  end

  def session(%Session{} = session, _opts), do: session

  defp run_child(parent, prompt_or_opts, opts) do
    session = prompt_or_opts |> session(opts) |> Registry.put()

    with {:ok, runtime} <- start_runtime_child(parent, session, opts) do
      case RuntimeSession.complete(runtime, Keyword.put(opts, :agent, session.id)) do
        {:ok, result} ->
          Registry.append(session.id, %Message{role: :assistant, content: result})
          {:ok, Result.ok(session, result)}

        {:error, reason} ->
          {:error, Result.error(session, reason)}
      end
    end
  end

  defp start_runtime_session(%Session{} = session, opts) do
    RuntimeSession.start(
      id: session.id,
      parent_id: session.parent_id,
      name: session.name,
      system: session.system,
      messages: session.messages,
      metadata: Map.merge(session.metadata, Map.new(Keyword.get(opts, :metadata, %{})))
    )
  end

  defp start_runtime_child(parent, %Session{} = session, opts) do
    RuntimeSession.child(parent,
      id: session.id,
      name: session.name,
      system: session.system,
      messages: session.messages,
      metadata: Map.merge(session.metadata, Map.new(Keyword.get(opts, :metadata, %{})))
    )
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
