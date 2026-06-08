defmodule Pi.MCP.JSONRPCTest do
  use ExUnit.Case, async: true

  alias Pi.MCP.JSONRPC
  alias Pi.Protocol.MCP.Error
  alias Pi.Protocol.MCP.Response

  test "initialize returns empty JSON-RPC result" do
    assert {:ok, %Response{} = response} =
             JSONRPC.handle(%{"jsonrpc" => "2.0", "id" => 1, "method" => "initialize"})

    assert JSONRPC.to_map(response) == %{"jsonrpc" => "2.0", "id" => 1, "result" => %{}}
  end

  test "unknown requests return transport error payload" do
    assert {:error, %Error{} = error} = JSONRPC.handle(%{})
    assert JSONRPC.to_map(error) == %{"error" => "Invalid request"}
  end
end
