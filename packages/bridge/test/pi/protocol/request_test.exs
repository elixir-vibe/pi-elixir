defmodule Pi.Protocol.RequestTest do
  use ExUnit.Case, async: true

  alias Pi.Protocol.Request

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
