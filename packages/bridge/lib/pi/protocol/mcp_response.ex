defmodule Pi.Protocol.MCPResponse do
  @moduledoc "MCP JSON-RPC response envelope."

  use JSONCodec, fast_path: :json

  alias Pi.Protocol.MCPResult

  defstruct [:jsonrpc, :id, result: %{}]

  @type t :: %__MODULE__{jsonrpc: String.t(), id: term(), result: MCPResult.t() | map()}
end
