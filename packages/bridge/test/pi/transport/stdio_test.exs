defmodule Pi.Transport.StdioTest do
  use ExUnit.Case, async: false

  alias Pi.Transport.Stdio

  test "ignores malformed JSON lines" do
    assert Stdio.__test_handle_line__("not json") == :ok
  end

  test "ignores malformed known protocol payloads" do
    assert Stdio.__test_handle_line__(Jason.encode!(%{type: :call})) == :ok
    assert Stdio.__test_handle_line__(Jason.encode!(%{type: :llm_chunk})) == :ok
  end
end
