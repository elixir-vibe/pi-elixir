defmodule Pi.Protocol.MCPError do
  @moduledoc "MCP JSON-RPC transport error payload."

  use JSONCodec, fast_path: :json

  defstruct [:error]

  @type t :: %__MODULE__{error: String.t()}
end
