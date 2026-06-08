defmodule Pi.Protocol.MCP.Response do
  @moduledoc "MCP JSON-RPC response envelope."

  use JSONCodec, fast_path: :json

  alias Pi.Protocol.MCP.Result

  defstruct [:jsonrpc, :id, result: %{}]

  @type t :: %__MODULE__{jsonrpc: String.t(), id: term(), result: Result.t() | map()}
end
