defmodule Pi.LLM.BrokerTest do
  use ExUnit.Case, async: false

  alias Pi.LLM
  alias Pi.LLM.Broker

  setup do
    :persistent_term.put({Pi.Transport.Stdio, :pid}, self())
    on_exit(fn -> :persistent_term.erase({Pi.Transport.Stdio, :pid}) end)
    :ok
  end

  test "multiplexes concurrent requests by id" do
    first = Task.async(fn -> LLM.complete("first") end)
    second = Task.async(fn -> LLM.complete("second") end)

    requests = [receive_request(), receive_request()]
    first_request = Enum.find(requests, &requested?(&1, "first"))
    second_request = Enum.find(requests, &requested?(&1, "second"))

    Broker.deliver(second_request.id, %{"ok" => true, "result" => "second result"})
    Broker.deliver(first_request.id, %{"ok" => true, "result" => "first result"})

    assert Task.await(first) == {:ok, "first result"}
    assert Task.await(second) == {:ok, "second result"}
  end

  defp requested?(request, content) do
    request.payload["messages"]
    |> List.first()
    |> Map.get("content")
    |> Kernel.==(content)
  end

  defp receive_request do
    receive do
      {:pi_transport_emit,
       %{"type" => "request", "id" => id, "op" => "llm_complete", "payload" => payload}} ->
        %{id: id, payload: payload}
    after
      500 -> flunk("expected LLM bridge request")
    end
  end
end
