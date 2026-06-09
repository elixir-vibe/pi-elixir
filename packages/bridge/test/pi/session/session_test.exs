defmodule Pi.Session.SessionTest do
  use ExUnit.Case, async: false

  alias Pi.Protocol.LLM.Message
  alias Pi.Session
  alias Pi.Session.State
  alias Pi.Session.Supervisor, as: SessionSupervisor

  setup do
    stop_supervisor()
    on_exit(&stop_supervisor/0)
    :ok
  end

  defp stop_supervisor do
    if pid = Process.whereis(SessionSupervisor) do
      Process.exit(pid, :kill)
      Process.sleep(5)
    end
  end

  test "starts, lists, and looks up server-owned sessions" do
    assert {:ok, pid} = Session.start(name: :reviewer)
    assert %State{id: id, name: :reviewer, status: :idle} = Session.state(pid)

    assert {:ok, ^pid} = Session.lookup(id)
    assert [%State{id: ^id}] = Session.list()
  end

  test "runs prompts through injectable ask function and records messages" do
    ask = fn [%Message{role: :user, content: "review"}], _opts -> {:ok, "done"} end
    assert {:ok, pid} = Session.start(ask_fun: ask)

    assert {:ok, "done"} = Session.run(pid, "review")

    assert %State{status: :done, result: "done", messages: messages, events: events} =
             Session.state(pid)

    assert Enum.map(messages, & &1.role) == [:user, :assistant]
    assert Enum.map(events, & &1.type) == [:started, :llm, :done]
  end

  test "subscribers receive state updates" do
    ask = fn _messages, _opts -> {:ok, "ok"} end
    assert {:ok, pid} = Session.start(ask_fun: ask)
    assert {:ok, %State{}} = Session.subscribe(pid)

    assert {:ok, "ok"} = Session.run(pid, "ping")

    assert_receive {:pi_session, _id, %State{status: :running}}
    assert_receive {:pi_session, _id, %State{status: :done, result: "ok"}}
  end

  test "emits session snapshots over the pi event bus" do
    :persistent_term.put({Pi.Transport.Stdio, :pid}, self())

    ask = fn _messages, _opts -> {:ok, "ok"} end
    assert {:ok, pid} = Session.start(name: :reviewer, ask_fun: ask)
    assert {:ok, "ok"} = Session.run(pid, "ping")

    snapshot = receive_done_snapshot()

    assert field(snapshot, :name) == "reviewer"
    assert field(snapshot, :latest) == "ok"
  after
    :persistent_term.erase({Pi.Transport.Stdio, :pid})
  end

  defp receive_done_snapshot do
    receive do
      {:pi_transport_emit, payload} ->
        snapshot = payload |> field(:data) |> field(:session)

        if is_map(snapshot) and field(snapshot, :status) == "done" do
          snapshot
        else
          receive_done_snapshot()
        end
    after
      1_000 -> flunk("expected done session snapshot")
    end
  end

  defp field(nil, _key), do: nil

  defp field(map, key) when is_map(map),
    do: Map.get(map, Atom.to_string(key)) || Map.get(map, key)

  test "emits delta events for streaming sessions" do
    stream_fun = fn _messages, _opts -> %Pi.LLM.Stream{id: "s1", stream: ["hel", "lo"]} end
    assert {:ok, pid} = Session.start(stream_fun: stream_fun)
    assert {:ok, "hello"} = Session.run(pid, "ping", stream: true)

    assert Enum.any?(Session.state(pid).events, fn event ->
             event.type == :delta and event.data == %{delta: "hel"}
           end)
  end

  test "reruns latest user message" do
    parent = self()

    ask = fn messages, _opts ->
      send(parent, {:messages, Enum.map(messages, & &1.content)})
      {:ok, "ok"}
    end

    assert {:ok, pid} = Session.start(ask_fun: ask)
    assert {:ok, "ok"} = Session.run(pid, "ping")
    assert {:ok, "ok"} = Session.rerun(pid)

    assert_receive {:messages, ["ping"]}
    assert_receive {:messages, ["ping", "ok", "ping"]}
  end

  test "returns camelCase protocol snapshots" do
    assert {:ok, pid} = Session.start(name: :root)
    id = Session.state(pid).id
    snapshot = Enum.find(Session.snapshots(), &(&1.id == id))

    assert snapshot.id == id
    assert snapshot.name == "root"
    assert snapshot.status == "idle"

    encoded = JSONCodec.dump(snapshot)
    assert encoded["messageCount"] == 0
    assert encoded["durationMs"] == 0
    assert Map.has_key?(encoded, "parentId")
    assert Map.has_key?(encoded, "startedAt")
    assert Map.has_key?(encoded, "updatedAt")
    refute Map.has_key?(encoded, "message_count")
    refute Map.has_key?(encoded, "duration_ms")
    refute Map.has_key?(encoded, "parent_id")
    refute Map.has_key?(encoded, "started_at")
    refute Map.has_key?(encoded, "updated_at")
  end

  test "snapshots include prompt and response previews" do
    assert {:ok, pid} = Session.start(ask_fun: fn _messages, _opts -> {:ok, "pong"} end)
    assert {:ok, "pong"} = Session.run(pid, "ping")

    snapshot = Pi.Session.Worker.snapshot(pid)
    encoded = JSONCodec.dump(snapshot)

    assert snapshot.prompt == "ping"
    assert snapshot.response == "pong"
    assert encoded["prompt"] == "ping"
    assert encoded["response"] == "pong"
    assert is_integer(encoded["durationMs"])
  end

  test "snapshots include failed prompt and error previews" do
    assert {:ok, pid} = Session.start(ask_fun: fn _messages, _opts -> {:error, "boom"} end)
    assert {:error, "boom"} = Session.run(pid, "ping")

    snapshot = Pi.Session.Worker.snapshot(pid)
    encoded = JSONCodec.dump(snapshot)

    assert snapshot.status == "failed"
    assert snapshot.prompt == "ping"
    assert snapshot.error == "boom"
    assert encoded["prompt"] == "ping"
    assert encoded["error"] == "boom"
  end

  test "snapshots include cancelled prompt previews" do
    assert {:ok, pid} =
             Session.start(
               ask_fun: fn _messages, _opts ->
                 Process.sleep(1_000)
                 {:ok, "late"}
               end
             )

    task = Task.async(fn -> Session.run(pid, "slow", timeout: 2_000) end)
    Process.sleep(20)
    assert :ok = Session.cancel(pid)
    assert {:error, :cancelled} = Task.await(task)

    snapshot = Pi.Session.Worker.snapshot(pid)
    encoded = JSONCodec.dump(snapshot)

    assert snapshot.status == "cancelled"
    assert snapshot.prompt == "slow"
    assert encoded["prompt"] == "slow"
  end

  test "creates child sessions" do
    assert {:ok, parent} = Session.start(name: :root)
    assert {:ok, child} = Session.child(parent, name: :reviewer)

    assert Session.state(child).parent_id == Session.state(parent).id
  end
end
