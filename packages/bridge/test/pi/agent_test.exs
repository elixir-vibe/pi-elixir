defmodule Pi.AgentTest do
  use ExUnit.Case, async: false

  alias Pi.Agent
  alias Pi.Agent.Registry
  alias Pi.Agent.Run
  alias Pi.Agent.Session
  alias Pi.LLM.Broker
  alias Pi.Protocol.LLM.Message
  alias Pi.Protocol.Response
  alias Pi.Session, as: RuntimeSession
  alias Pi.Session.Supervisor, as: SessionSupervisor

  setup do
    if pid = Process.whereis(Registry), do: GenServer.stop(pid)
    if pid = Process.whereis(Broker), do: GenServer.stop(pid)
    if pid = Process.whereis(SessionSupervisor), do: GenServer.stop(pid)
    :persistent_term.put({Pi.Transport.Stdio, :pid}, self())
    on_exit(fn -> :persistent_term.erase({Pi.Transport.Stdio, :pid}) end)
    :ok
  end

  test "creates top-level sessions from prompts" do
    session = Agent.session("review this", name: :reviewer)

    assert %Session{name: :reviewer, parent_id: nil} = session
    assert [%Message{role: :user, content: "review this"}] = session.messages
  end

  test "creates child sessions" do
    parent = Agent.session("plan", name: :planner)
    child = Agent.child(parent, name: :reviewer)

    assert child.parent_id == parent.id
    assert child.name == :reviewer
    assert Agent.children(parent) == [child]
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
  end

  test "tracks session history" do
    session = Agent.session("review this", name: :reviewer) |> Registry.put()

    assert Agent.sessions() == [session]
    assert Agent.history(session) == [%Message{role: :user, content: "review this"}]

    Registry.append(session.id, %Message{role: :assistant, content: "done"})

    assert Agent.history(session) == [
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
