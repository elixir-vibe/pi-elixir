defmodule Pi.Protocol.ResultTest do
  use ExUnit.Case, async: true

  alias Pi.Protocol.Result

  test "encodes result envelopes from structs" do
    result = Result.to_map(%Result{type: :result, id: 1, text: "ok", is_error: false})

    assert result["type"] == "result"
    assert result["is_error"] == "false"
  end
end
