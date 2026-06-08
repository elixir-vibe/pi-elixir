defmodule Pi.Docs.ProtocolExamplesTest do
  use ExUnit.Case, async: true

  alias Pi.Bridge.Info
  alias Pi.Protocol.LLM.Cancel
  alias Pi.Protocol.LLM.Chunk
  alias Pi.Protocol.LLM.Done
  alias Pi.Protocol.LLM.Message
  alias Pi.Protocol.MCP.Request, as: MCPRequest
  alias Pi.Protocol.Ready
  alias Pi.Protocol.Request
  alias Pi.Protocol.Response
  alias Pi.Protocol.Result
  alias Pi.Protocol.UIEvent
  alias Pi.Transport.Stdio

  test "stdio ready example is produced from protocol structs" do
    payload = Stdio.__test_payload__(%Ready{type: :ready, info: Info.snapshot(:stdio)})

    assert payload["type"] == "ready"
    assert payload["info"]["transport"] == "stdio"
    assert is_list(payload["info"]["apis"]["runtime"])
  end

  test "stdio call/result and LLM request examples decode or encode through protocol structs" do
    assert %Result{type: :result, id: 1, text: "2", is_error: false} =
             Result.from_map!(%{"type" => "result", "id" => 1, "text" => "2", "isError" => false})

    request = %Request{
      type: :request,
      id: "llm_123_1",
      op: :llm_complete,
      payload: %{messages: [%Message{role: :user, content: "hello"}], opts: %{}}
    }

    assert %{"type" => "request", "op" => "llm_complete"} = Stdio.__test_payload__(request)

    assert %Response{type: :response, id: "llm_123_1", ok: true, result: "hello from pi"} =
             Response.from_map!(%{
               "type" => "response",
               "id" => "llm_123_1",
               "ok" => true,
               "result" => "hello from pi"
             })
  end

  test "LLM stream and cancel examples decode through protocol structs" do
    assert %Chunk{type: :llm_chunk, id: "llm_456_2", delta: "first "} =
             Chunk.from_map!(%{"type" => "llm_chunk", "id" => "llm_456_2", "delta" => "first "})

    assert %Done{type: :llm_done, id: "llm_456_2", result: ""} =
             Done.from_map!(%{"type" => "llm_done", "id" => "llm_456_2", "result" => ""})

    assert %Cancel{type: :llm_cancel, id: "llm_456_2", reason: "closed"} =
             Cancel.from_map!(%{
               "type" => "llm_cancel",
               "id" => "llm_456_2",
               "reason" => "closed"
             })
  end

  test "UI and MCP examples encode or decode through protocol structs" do
    assert %{"type" => "ui", "op" => "status", "key" => "ecto", "text" => "ecto 1/1"} =
             Stdio.__test_payload__(%UIEvent{
               type: :ui,
               op: :status,
               key: :ecto,
               text: "ecto 1/1"
             })

    assert %MCPRequest{jsonrpc: "2.0", id: 1, method: "tools/call"} =
             MCPRequest.from_map!(%{
               "jsonrpc" => "2.0",
               "id" => 1,
               "method" => "tools/call",
               "params" => %{"name" => "project_eval", "arguments" => %{"code" => "1 + 1"}}
             })
  end
end
