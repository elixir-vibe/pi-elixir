defmodule Pi.LLM.BrokerTest do
  use ExUnit.Case, async: false

  alias Pi.LLM
  alias Pi.LLM.Broker
  alias Pi.Protocol.Response

  setup do
    :persistent_term.put({Pi.Transport.Stdio, :pid}, self())
    on_exit(fn -> :persistent_term.erase({Pi.Transport.Stdio, :pid}) end)
    :ok
  end

  test "multiplexes concurrent requests by id" do
    first = Task.async(fn -> LLM.complete("first") end)
    second = Task.async(fn -> LLM.complete("second") end)

    requests = [receive_request(:llm_complete), receive_request(:llm_complete)]
    first_request = Enum.find(requests, &requested?(&1, "first"))
    second_request = Enum.find(requests, &requested?(&1, "second"))

    Broker.deliver(second_request.id, %Response{ok: true, result: "second result"})
    Broker.deliver(first_request.id, %Response{ok: true, result: "first result"})

    assert Task.await(first) == {:ok, "first result"}
    assert Task.await(second) == {:ok, "second result"}
  end

  test "streams LLM chunks until done" do
    stream = LLM.stream("stream")
    request = receive_request(:llm_stream)

    send(self(), {:pi_llm_chunk, request.id, "first "})
    send(self(), {:pi_llm_chunk, request.id, "second"})
    send(self(), {:pi_llm_done, request.id, " done"})

    assert stream.id == request.id
    assert Enum.to_list(stream.stream) == ["first ", "second", " done"]
  end

  test "cancels stream when consumer closes early" do
    stream = LLM.stream("stream")
    request = receive_request(:llm_stream)

    send(self(), {:pi_llm_chunk, request.id, "first"})

    assert Enum.take(stream.stream, 1) == ["first"]
    assert receive_cancel(request.id, "closed")
  end

  test "cancels stream on timeout" do
    stream = LLM.stream("stream", timeout: 1)
    request = receive_request(:llm_stream)

    assert Enum.to_list(stream.stream) == []
    assert receive_cancel(request.id, "timeout")
  end

  test "raises on streaming LLM error" do
    stream = LLM.stream("stream")
    request = receive_request(:llm_stream)

    send(self(), {:pi_llm_error, request.id, "boom"})

    assert_raise RuntimeError, ~s("boom"), fn -> Enum.to_list(stream.stream) end
  end

  defp requested?(request, content) do
    request.payload["messages"]
    |> List.first()
    |> Map.get("content")
    |> Kernel.==(content)
  end

  defp receive_request(op) do
    expected_op = Atom.to_string(op)

    receive do
      {:pi_transport_emit,
       %{"type" => "request", "id" => id, "op" => ^expected_op, "payload" => payload}} ->
        %{id: id, payload: payload}
    after
      500 -> flunk("expected #{op} bridge request")
    end
  end

  defp receive_cancel(id, reason) do
    receive do
      {:pi_transport_emit, %{"type" => "llm_cancel", "id" => ^id, "reason" => ^reason}} -> true
    after
      500 -> flunk("expected LLM cancel #{reason}")
    end
  end
end
