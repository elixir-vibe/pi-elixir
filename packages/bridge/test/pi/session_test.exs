defmodule Pi.SessionTest do
  use ExUnit.Case, async: false

  alias Pi.LLM.Broker
  alias Pi.LLM.Stream, as: LLMStream
  alias Pi.Protocol.LLM.Message
  alias Pi.Protocol.Response
  alias Pi.Session
  alias Pi.Session.State
  alias Pi.Session.Supervisor, as: SessionSupervisor
  alias Pi.Session.Worker

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

  defp wait_for(fun, attempts \\ 50)

  defp wait_for(fun, attempts) when attempts > 0 do
    if fun.() do
      :ok
    else
      Process.sleep(10)
      wait_for(fun, attempts - 1)
    end
  end

  defp wait_for(_fun, 0), do: flunk("timed out waiting for condition")

  defp assert_request(op, custom_type, data) do
    receive do
      {:pi_transport_emit, payload} ->
        assert field(payload, :type) == "request"
        assert field(payload, :op) == Atom.to_string(op)
        request_payload = field(payload, :payload)
        assert field(request_payload, :customType) == custom_type
        assert field(request_payload, :data) == data
        Broker.deliver(field(payload, :id), %Response{ok: true, result: "ok"})
    after
      1_000 -> flunk("expected #{op} request")
    end
  end

  defp field(nil, _key), do: nil

  defp field(map, key) when is_map(map),
    do: Map.get(map, Atom.to_string(key)) || Map.get(map, key)

  test "emits delta events for streaming sessions" do
    stream_fun = fn _messages, _opts -> %LLMStream{id: "s1", stream: ["hel", "lo"]} end
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

    snapshot = Worker.snapshot(pid)
    encoded = JSONCodec.dump(snapshot)

    assert snapshot.run_count == 2
    assert encoded["runCount"] == 2
    assert is_binary(encoded["completedAt"])
  end

  test "host session helpers accept keyword custom data" do
    :persistent_term.put({Pi.Transport.Stdio, :pid}, self())

    append_task = Task.async(fn -> Session.append_entry("demo-state", count: 1) end)
    assert_request(:append_entry, "demo-state", %{"count" => 1})
    assert {:ok, "ok"} = Task.await(append_task)

    message_task = Task.async(fn -> Session.send_message("demo-message", count: 2) end)
    assert_request(:send_message, "demo-message", %{"count" => 2})
    assert {:ok, "ok"} = Task.await(message_task)
  after
    :persistent_term.erase({Pi.Transport.Stdio, :pid})
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
    assert encoded["runCount"] == 0
    assert encoded["recentOutput"] == []
    assert Map.has_key?(encoded, "parentId")
    assert Map.has_key?(encoded, "startedAt")
    assert Map.has_key?(encoded, "updatedAt")
    assert Map.has_key?(encoded, "completedAt")
    refute Map.has_key?(encoded, "message_count")
    refute Map.has_key?(encoded, "duration_ms")
    refute Map.has_key?(encoded, "parent_id")
    refute Map.has_key?(encoded, "started_at")
    refute Map.has_key?(encoded, "updated_at")
  end

  test "snapshots include prompt and response previews" do
    assert {:ok, pid} = Session.start(ask_fun: fn _messages, _opts -> {:ok, "pong"} end)
    assert {:ok, "pong"} = Session.run(pid, "ping")

    snapshot = Worker.snapshot(pid)
    encoded = JSONCodec.dump(snapshot)

    assert snapshot.prompt == "ping"
    assert snapshot.response == "pong"
    assert encoded["prompt"] == "ping"
    assert encoded["response"] == "pong"
    assert encoded["runCount"] == 1
    assert is_binary(encoded["completedAt"])
    assert is_integer(encoded["durationMs"])
  end

  test "snapshots include streaming live previews" do
    stream_fun = fn _messages, _opts ->
      %{stream: ["one", "two"]}
    end

    assert {:ok, pid} = Session.start(stream_fun: stream_fun)
    assert {:ok, "onetwo"} = Session.run(pid, "stream", stream: true)

    snapshot = Worker.snapshot(pid)
    encoded = JSONCodec.dump(snapshot)

    assert snapshot.recent_output == ["one", "two"]
    assert encoded["recentOutput"] == ["one", "two"]
    assert encoded["runCount"] == 1
  end

  test "running streaming snapshots expose current streaming activity" do
    {:ok, gate} = Agent.start_link(fn -> :open end)

    stream_fun = fn _messages, _opts ->
      stream =
        Stream.resource(
          fn -> :first end,
          fn
            :first ->
              {["one"], :wait}

            :wait ->
              Agent.update(gate, fn _ -> :waiting end)
              wait_for(fn -> Agent.get(gate, & &1) == :finish end)
              {["two"], :done}

            :done ->
              {:halt, :done}
          end,
          fn _state -> :ok end
        )

      %{stream: stream}
    end

    assert {:ok, pid} = Session.start(stream_fun: stream_fun)
    task = Task.async(fn -> Session.run(pid, "stream", stream: true) end)

    wait_for(fn -> Agent.get(gate, & &1) == :waiting end)
    wait_for(fn -> Worker.snapshot(pid).current == "streaming" end)

    snapshot = Worker.snapshot(pid)
    encoded = JSONCodec.dump(snapshot)

    assert snapshot.recent_output == ["one"]
    assert encoded["current"] == "streaming"
    assert encoded["recentOutput"] == ["one"]

    Agent.update(gate, fn _ -> :finish end)
    assert {:ok, "onetwo"} = Task.await(task)
  end

  test "snapshots include failed prompt and error previews" do
    assert {:ok, pid} = Session.start(ask_fun: fn _messages, _opts -> {:error, "boom"} end)
    assert {:error, "boom"} = Session.run(pid, "ping")

    snapshot = Worker.snapshot(pid)
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

    snapshot = Worker.snapshot(pid)
    encoded = JSONCodec.dump(snapshot)

    assert snapshot.status == "cancelled"
    assert snapshot.prompt == "slow"
    assert snapshot.current == nil
    assert is_binary(snapshot.completed_at)
    assert encoded["prompt"] == "slow"
    assert encoded["current"] == nil
    assert is_binary(encoded["completedAt"])
  end

  test "creates child sessions" do
    assert {:ok, parent} = Session.start(name: :root)
    assert {:ok, child} = Session.child(parent, name: :reviewer)

    assert Session.state(child).parent_id == Session.state(parent).id
  end
end
