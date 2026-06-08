defmodule Pi.MCP.JSONRPC do
  @moduledoc "JSON-RPC response helpers for MCP HTTP transports."

  alias Pi.MCP.Tools

  def handle(%{"jsonrpc" => "2.0", "id" => id, "method" => "tools/call", "params" => params}) do
    name = params["name"]
    args = params["arguments"] || %{}

    case Tools.dispatch(name, args) do
      {:ok, text} -> success(id, text)
      {:error, message} -> tool_error(id, message)
    end
  end

  def handle(%{"jsonrpc" => "2.0", "id" => id, "method" => "initialize"}), do: empty(id)
  def handle(%{"jsonrpc" => "2.0", "id" => id}), do: empty(id)
  def handle(_), do: {:error, %{error: "Invalid request"}}

  def success(id, text) do
    {:ok, %{jsonrpc: "2.0", id: id, result: %{content: [%{type: "text", text: text}]}}}
  end

  def tool_error(id, message) do
    {:ok,
     %{
       jsonrpc: "2.0",
       id: id,
       result: %{content: [%{type: "text", text: message}], isError: true}
     }}
  end

  def empty(id), do: {:ok, %{jsonrpc: "2.0", id: id, result: %{}}}
end
