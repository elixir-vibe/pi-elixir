defmodule Pi.AgentTest do
  use ExUnit.Case, async: false

  alias Pi.Agent
  alias Pi.Agent.Registry
  alias Pi.Agent.Session

  test "creates top-level sessions from prompts" do
    session = Agent.session("review this", name: :reviewer)

    assert %Session{name: :reviewer, parent_id: nil} = session
    assert [%{role: :user, content: "review this"}] = session.messages
  end

  setup do
    if pid = Process.whereis(Registry), do: GenServer.stop(pid)
    :ok
  end

  test "creates child sessions" do
    parent = Agent.session("plan", name: :planner)
    child = Agent.child(parent, name: :reviewer)

    assert child.parent_id == parent.id
    assert child.name == :reviewer
    assert Agent.children(parent) == [child]
  end

  test "tracks session history" do
    session = Agent.session("review this", name: :reviewer) |> Registry.put()

    assert Agent.sessions() == [session]
    assert Agent.history(session) == [%{role: :user, content: "review this"}]

    Registry.append(session.id, %{role: :assistant, content: "done"})

    assert Agent.history(session) == [
             %{role: :user, content: "review this"},
             %{role: :assistant, content: "done"}
           ]
  end
end
