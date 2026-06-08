defmodule Pi.Agent do
  @moduledoc "Unified BEAM abstraction for top-level agents and child agents."

  alias Pi.Agent.Session
  alias Pi.LLM

  def run(prompt_or_opts, opts \\ []) do
    session = session(prompt_or_opts, opts)
    messages = messages(session)

    with {:ok, result} <- LLM.complete(messages, Keyword.put(opts, :agent, session.id)) do
      {:ok, %{session: session, result: result}}
    end
  end

  def run!(prompt_or_opts, opts \\ []) do
    case run(prompt_or_opts, opts) do
      {:ok, result} -> result
      {:error, reason} -> raise RuntimeError, message: to_string(reason)
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
    runs
    |> Enum.map(&async(&1, opts))
    |> await_many(Keyword.get(opts, :timeout, 60_000) + 1_000)
  end

  def chain(steps, opts \\ []) when is_list(steps) do
    Enum.reduce_while(steps, {:ok, nil}, fn step, {:ok, previous} ->
      input = chain_input(step, previous)

      case run(input, opts) do
        {:ok, %{result: result}} = ok -> {:cont, ok_result(ok, result)}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  def child(%Session{} = parent, opts \\ []) do
    Session.child(parent, opts)
  end

  def session(prompt_or_opts, opts \\ [])

  def session(prompt, opts) when is_binary(prompt) do
    opts
    |> Keyword.put(:messages, [%{role: :user, content: prompt}])
    |> Session.new()
  end

  def session(opts, extra_opts) when is_list(opts) do
    opts
    |> Keyword.merge(extra_opts)
    |> Session.new()
  end

  def session(%Session{} = session, _opts), do: session

  defp messages(%Session{system: nil, messages: messages}), do: messages

  defp messages(%Session{system: system, messages: messages}),
    do: [%{role: :system, content: system} | messages]

  defp chain_input(step, nil), do: step

  defp chain_input(step, previous) when is_binary(step),
    do: step <> "\n\nPrevious result:\n" <> inspect(previous)

  defp chain_input(step, previous) when is_list(step) do
    Keyword.update(step, :messages, [%{role: :user, content: inspect(previous)}], fn messages ->
      messages ++ [%{role: :user, content: inspect(previous)}]
    end)
  end

  defp ok_result({:ok, %{session: session}}, result),
    do: {:ok, %{session: session, result: result}}
end
