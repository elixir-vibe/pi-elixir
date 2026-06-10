defmodule Pi.AgentTest do
  use ExUnit.Case, async: false

  alias Pi.Agent
  alias Pi.Agent.Run
  alias Pi.LLM.Broker
  alias Pi.Protocol.LLM.Message
  alias Pi.Protocol.Response
  alias Pi.Session, as: RuntimeSession
  alias Pi.Session.Supervisor, as: SessionSupervisor

  setup do
    if pid = Process.whereis(Pi.Agent.Manager), do: GenServer.stop(pid)
    if pid = Process.whereis(Pi.Agent.JobSupervisor), do: GenServer.stop(pid)
    if pid = Process.whereis(Broker), do: GenServer.stop(pid)
    if pid = Process.whereis(SessionSupervisor), do: GenServer.stop(pid)
    :persistent_term.put({Pi.Transport.Stdio, :pid}, self())
    on_exit(fn -> :persistent_term.erase({Pi.Transport.Stdio, :pid}) end)
    :ok
  end

  test "creates top-level sessions from prompts" do
    session = Agent.session("review this", name: :reviewer)

    assert %Pi.Session.State{name: :reviewer, parent_id: nil} = session
    assert [%Message{role: :user, content: "review this"}] = session.messages
  end

  test "creates child sessions" do
    parent = Agent.session("plan", name: :planner)
    child = Agent.child(parent, name: :reviewer)

    assert child.parent_id == parent.id
    assert child.name == :reviewer
    assert Agent.history(parent) == [%Message{role: :user, content: "plan"}]
    assert Agent.children(parent) == []
  end

  test "chains agent runs into a structured orchestration result" do
    task = Task.async(fn -> Agent.chain(["draft", "review"]) end)

    first = receive_request(:llm_complete)
    Broker.deliver(first.id, %Response{ok: true, result: "plan"})

    second = receive_request(:llm_complete)
    Broker.deliver(second.id, %Response{ok: true, result: "review"})

    assert {:ok, %Run{kind: :chain, status: :ok, results: [first_result, second_result]}} =
             Task.await(task)

    assert first_result.result == "plan"
    assert second_result.result == "review"
  end

  test "parallel runs use child runtime sessions" do
    task = Task.async(fn -> Agent.parallel(["tests", "docs"], name: :review) end)

    first = receive_request(:llm_complete)
    Broker.deliver(first.id, %Response{ok: true, result: "tests ok"})

    second = receive_request(:llm_complete)
    Broker.deliver(second.id, %Response{ok: true, result: "docs ok"})

    assert {:ok, %Run{kind: :parallel, status: :ok, results: results}} = Task.await(task)
    assert Enum.map(results, & &1.result) |> Enum.sort() == ["docs ok", "tests ok"]

    states = RuntimeSession.list()
    parent = Enum.find(states, &(&1.name == :review))
    assert parent
    children = Enum.filter(states, &(&1.parent_id == parent.id))
    assert [_, _] = children
    assert Enum.map(children, & &1.name) |> Enum.sort() == ["docs", "tests"]
  end

  test "supervised jobs expose lifecycle result and child session" do
    assert {:ok, job} = Agent.start("review job", role: :reviewer)
    assert job.status == :running
    assert {:ok, running} = Agent.status(job.id)
    assert running.child_session_id == job.child_session_id

    request = receive_request(:llm_complete)
    Broker.deliver(request.id, %Response{ok: true, result: "job done"})

    assert {:ok, done} = Agent.await(job, 1_000)
    assert done.status == :done
    assert done.result == "job done"
    assert Agent.result(done.id) == {:ok, "job done"}

    assert %Pi.Session.State{messages: messages} = RuntimeSession.state(done.child_session_id)
    assert Enum.map(messages, & &1.content) == ["review job", "job done"]
  end

  test "run_many starts multiple supervised jobs" do
    assert {:ok, jobs} =
             Agent.run_many([
               %{task: "review tests", role: :reviewer},
               "review docs"
             ])

    assert [first_job, second_job] = jobs
    assert Enum.all?([first_job, second_job], &match?(%Pi.Agent.Job{status: :running}, &1))

    first = receive_request(:llm_complete)
    second = receive_request(:llm_complete)
    Broker.deliver(first.id, %Response{ok: true, result: "one"})
    Broker.deliver(second.id, %Response{ok: true, result: "two"})

    assert Enum.map(jobs, &Agent.await(&1, 1_000)) |> Enum.all?(&match?({:ok, _}, &1))
  end

  test "lists runtime sessions and reads canonical runtime history" do
    task = Task.async(fn -> Agent.run("review this", name: :reviewer) end)

    request = receive_request(:llm_complete)
    Broker.deliver(request.id, %Response{ok: true, result: "done"})

    assert {:ok, result} = Task.await(task)
    assert result.session.name == :reviewer

    assert [%Pi.Session.State{name: :reviewer} = runtime] = Agent.sessions()

    assert Agent.history(runtime) == [
             %Message{role: :user, content: "review this"},
             %Message{role: :assistant, content: "done"}
           ]
  end

  defp receive_request(op) do
    expected_op = Atom.to_string(op)

    receive do
      {:pi_transport_emit, %{type: "request", id: id, op: ^expected_op, payload: payload}} ->
        %{id: id, payload: payload}

      {:pi_transport_emit,
       %{"type" => "request", "id" => id, "op" => ^expected_op, "payload" => payload}} ->
        %{id: id, payload: payload}
    after
      1_000 -> flunk("expected #{op} bridge request")
    end
  end
end
