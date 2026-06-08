defmodule Pi.Protocol.MCPResult do
  @moduledoc "MCP JSON-RPC result payload."

  use JSONCodec, fast_path: :json

  alias Pi.Protocol.MCPContent

  defstruct content: [], is_error: nil

  @type t :: %__MODULE__{content: [MCPContent.t()], is_error: boolean() | nil}

  codec(:is_error, as: "isError")
end
