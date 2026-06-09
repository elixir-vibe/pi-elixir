defmodule Pi.MCP.JSONRPC do
  @moduledoc "JSON-RPC response helpers for MCP HTTP transports."

  alias Pi.MCP.Tools
  alias Pi.Protocol.MCP.Content
  alias Pi.Protocol.MCP.Error
  alias Pi.Protocol.MCP.Request
  alias Pi.Protocol.MCP.Response
  alias Pi.Protocol.MCP.Result

  def handle(%{"jsonrpc" => "2.0"} = payload) do
    case Request.from_map(payload) do
      {:ok, request} -> handle_request(request)
      {:error, _reason} -> invalid()
    end
  end

  def handle(_), do: invalid()

  def success(id, text) do
    {:ok, response(id, %Result{content: [text_content(text)]})}
  end

  def tool_error(id, message) do
    {:ok, response(id, %Result{content: [text_content(message)], is_error: true})}
  end

  def empty(id), do: {:ok, response(id, %{})}

  def to_map(%Error{} = error), do: JSONCodec.dump(error)
  def to_map(%Response{} = response), do: response |> JSONCodec.dump() |> drop_nil_fields()

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

  defp drop_nil_fields(map) when is_map(map) do
    map
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new(fn {key, value} -> {key, drop_nil_fields(value)} end)
  end

  defp drop_nil_fields(values) when is_list(values), do: Enum.map(values, &drop_nil_fields/1)
  defp drop_nil_fields(value), do: value
end
