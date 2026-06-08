defmodule Pi.Protocol.ResponseTest do
  use ExUnit.Case, async: true

  alias Pi.Protocol.Response

  test "decodes response envelopes into strict structs" do
    response =
      Response.from_map!(%{"type" => "response", "id" => "r1", "ok" => true, "result" => "done"})

    assert %Response{type: :response, id: "r1", ok: true, result: "done"} = response
  end
end
