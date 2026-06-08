defmodule Pi.Protocol.MCP.Result do
  @moduledoc "MCP JSON-RPC result payload."

  use JSONCodec, fast_path: :json

  alias Pi.Protocol.MCP.Content

  defstruct content: [], is_error: nil

  @type t :: %__MODULE__{content: [Content.t()], is_error: boolean() | nil}

  codec(:is_error, as: "isError")
end
