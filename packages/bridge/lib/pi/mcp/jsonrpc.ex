defmodule Pi.MCP.JSONRPC do
  @moduledoc "JSON-RPC response helpers for MCP HTTP transports."

  alias Pi.MCP.Tools
  alias Pi.Protocol.MCPContent
  alias Pi.Protocol.MCPError
  alias Pi.Protocol.MCPRequest
  alias Pi.Protocol.MCPResponse
  alias Pi.Protocol.MCPResult

  def handle(%{"jsonrpc" => "2.0"} = payload) do
    payload
    |> MCPRequest.from_map!()
    |> handle_request()
  rescue
    _ -> invalid()
  end

  def handle(_), do: invalid()

  def success(id, text) do
    {:ok, response(id, %MCPResult{content: [text_content(text)]})}
  end

  def tool_error(id, message) do
    {:ok, response(id, %MCPResult{content: [text_content(message)], is_error: true})}
  end

  def empty(id), do: {:ok, response(id, %{})}

  def to_map(%MCPError{} = error), do: MCPError.to_map(error)
  def to_map(%MCPResponse{} = response), do: response_to_map(response)

  defp handle_request(%MCPRequest{method: "tools/call", id: id, params: params}) do
    name = params["name"]
    args = params["arguments"] || %{}

    case Tools.dispatch(name, args) do
      {:ok, text} -> success(id, text)
      {:error, message} -> tool_error(id, message)
    end
  end

  defp handle_request(%MCPRequest{method: "initialize", id: id}), do: empty(id)
  defp handle_request(%MCPRequest{id: id}), do: empty(id)

  defp invalid, do: {:error, %MCPError{error: "Invalid request"}}

  defp response(id, result), do: %MCPResponse{jsonrpc: "2.0", id: id, result: result}
  defp text_content(text), do: %MCPContent{type: "text", text: text}

  defp response_to_map(%MCPResponse{result: %MCPResult{} = result} = response) do
    response
    |> MCPResponse.to_map()
    |> Map.put("result", result_to_map(result))
  end

  defp response_to_map(%MCPResponse{} = response), do: MCPResponse.to_map(response)

  defp result_to_map(%MCPResult{content: content, is_error: is_error}) do
    %{"content" => Enum.map(content, &MCPContent.to_map/1)}
    |> maybe_put_is_error(is_error)
  end

  defp maybe_put_is_error(map, nil), do: map
  defp maybe_put_is_error(map, is_error), do: Map.put(map, "isError", is_error)
end
