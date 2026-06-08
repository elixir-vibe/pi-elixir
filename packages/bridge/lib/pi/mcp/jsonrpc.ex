defmodule Pi.MCP.JSONRPC do
  @moduledoc "JSON-RPC response helpers for MCP HTTP transports."

  alias Pi.MCP.Tools
  alias Pi.Protocol.MCP.Content
  alias Pi.Protocol.MCP.Error
  alias Pi.Protocol.MCP.Request
  alias Pi.Protocol.MCP.Response
  alias Pi.Protocol.MCP.Result

  def handle(%{"jsonrpc" => "2.0"} = payload) do
    payload
    |> Request.from_map!()
    |> handle_request()
  rescue
    _ -> invalid()
  end

  def handle(_), do: invalid()

  def success(id, text) do
    {:ok, response(id, %Result{content: [text_content(text)]})}
  end

  def tool_error(id, message) do
    {:ok, response(id, %Result{content: [text_content(message)], is_error: true})}
  end

  def empty(id), do: {:ok, response(id, %{})}

  def to_map(%Error{} = error), do: Error.to_map(error)
  def to_map(%Response{} = response), do: response_to_map(response)

  defp handle_request(%Request{method: "tools/call", id: id, params: params}) do
    name = params["name"]
    args = params["arguments"] || %{}

    case Tools.dispatch(name, args) do
      {:ok, text} -> success(id, text)
      {:error, message} -> tool_error(id, message)
    end
  end

  defp handle_request(%Request{method: "initialize", id: id}), do: empty(id)
  defp handle_request(%Request{id: id}), do: empty(id)

  defp invalid, do: {:error, %Error{error: "Invalid request"}}

  defp response(id, result), do: %Response{jsonrpc: "2.0", id: id, result: result}
  defp text_content(text), do: %Content{type: "text", text: text}

  defp response_to_map(%Response{result: %Result{} = result} = response) do
    response
    |> Response.to_map()
    |> Map.put("result", result_to_map(result))
  end

  defp response_to_map(%Response{} = response), do: Response.to_map(response)

  defp result_to_map(%Result{content: content, is_error: is_error}) do
    %{"content" => Enum.map(content, &Content.to_map/1)}
    |> maybe_put_is_error(is_error)
  end

  defp maybe_put_is_error(map, nil), do: map
  defp maybe_put_is_error(map, is_error), do: Map.put(map, "isError", is_error)
end
