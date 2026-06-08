defmodule Pi.AgentTest do
  use ExUnit.Case, async: true

  alias Pi.Agent
  alias Pi.Agent.Session

  test "creates top-level sessions from prompts" do
    session = Agent.session("review this", name: :reviewer)

    assert %Session{name: :reviewer, parent_id: nil} = session
    assert [%{role: :user, content: "review this"}] = session.messages
  end

  test "creates child sessions" do
    parent = Agent.session("plan", name: :planner)
    child = Agent.child(parent, name: :reviewer)

    assert child.parent_id == parent.id
    assert child.name == :reviewer
  end
end
