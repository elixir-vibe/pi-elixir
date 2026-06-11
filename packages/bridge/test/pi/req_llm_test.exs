defmodule Pi.ReqLLMTest do
  use ExUnit.Case, async: false

  alias Pi.LLM.Broker
  alias Pi.Protocol.Response

  setup do
    :persistent_term.put({Pi.Transport.Stdio, :pid}, self())
    ReqLLM.Providers.initialize()
    Pi.ReqLLM.install()

    on_exit(fn ->
      :persistent_term.erase({Pi.Transport.Stdio, :pid})
      ReqLLM.Providers.unregister(:pi)
    end)

    :ok
  end

  test "backs ReqLLM.generate_text with the active Pi model" do
    model = Pi.ReqLLM.current_model()
    assert model.provider == :pi
    assert model.id == "current"

    task = Task.async(fn -> ReqLLM.generate_text(model, "hello") end)

    request = receive_request()
    assert messages(request) == [%{content: "hello", role: "user"}]

    Broker.deliver(request.id, %Response{ok: true, result: "hello from pi"})

    assert {:ok, response} = Task.await(task)
    assert ReqLLM.Response.text(response) == "hello from pi"
  end

  defp messages(%{payload: %{messages: messages}}), do: messages
  defp messages(%{payload: %{"messages" => messages}}), do: Enum.map(messages, &atomize_message/1)

  defp atomize_message(%{"content" => content, "role" => role}),
    do: %{content: content, role: role}

  defp atomize_message(message), do: message

  defp receive_request do
    receive do
      {:pi_transport_emit, %{type: "request", id: id, op: "llm_complete", payload: payload}} ->
        %{id: id, payload: payload}

      {:pi_transport_emit,
       %{"type" => "request", "id" => id, "op" => "llm_complete", "payload" => payload}} ->
        %{id: id, payload: payload}
    after
      3_000 -> flunk("expected LLM bridge request")
    end
  end
end
