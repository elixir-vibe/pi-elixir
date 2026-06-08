defmodule Pi.ProtocolTest do
  use ExUnit.Case, async: true

  alias Pi.Protocol.Request
  alias Pi.Protocol.Response
  alias Pi.Protocol.Result

  test "decodes response envelopes into strict structs" do
    response =
      Response.from_map!(%{"type" => "response", "id" => "r1", "ok" => true, "result" => "done"})

    assert %Response{type: :response, id: "r1", ok: true, result: "done"} = response
  end

  test "encodes result envelopes from structs" do
    result = Result.to_map(%Result{type: :result, id: 1, text: "ok", is_error: false})

    assert result["type"] == "result"
    assert result["is_error"] == "false"
  end

  test "request ops use explicit existing atoms" do
    request =
      Request.from_map!(%{
        "type" => "request",
        "id" => "r1",
        "op" => "llm_complete",
        "payload" => %{}
      })

    assert request.op == :llm_complete
  end
end
