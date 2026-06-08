defmodule Pi.MCP.JSONRPCTest do
  use ExUnit.Case, async: true

  alias Pi.MCP.JSONRPC

  test "initialize returns empty JSON-RPC result" do
    assert {:ok, response} =
             JSONRPC.handle(%{"jsonrpc" => "2.0", "id" => 1, "method" => "initialize"})

    assert response == %{jsonrpc: "2.0", id: 1, result: %{}}
  end

  test "unknown requests return transport error payload" do
    assert {:error, %{error: "Invalid request"}} = JSONRPC.handle(%{})
  end
end
