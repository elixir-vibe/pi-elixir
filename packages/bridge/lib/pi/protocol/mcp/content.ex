defmodule Pi.Protocol.MCP.Content do
  @moduledoc "Text content item in an MCP JSON-RPC response."

  use JSONCodec, fast_path: :json

  defstruct [:type, :text]

  @type t :: %__MODULE__{type: String.t(), text: String.t()}
end
