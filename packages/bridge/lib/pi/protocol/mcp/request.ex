defmodule Pi.Protocol.MCP.Request do
  @moduledoc "MCP JSON-RPC request envelope."

  use JSONCodec, fast_path: :json

  defstruct [:jsonrpc, :id, :method, params: %{}]

  @type t :: %__MODULE__{jsonrpc: String.t(), id: term(), method: String.t(), params: map()}
end
