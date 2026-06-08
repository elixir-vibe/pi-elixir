defmodule Pi.Protocol.PluginHook do
  @moduledoc "Pi-to-BEAM plugin tool hook payload."

  use JSONCodec, fast_path: :json

  defstruct [:tool_name, :tool_call_id, input: %{}, content: nil, is_error: false]

  @type t :: %__MODULE__{
          tool_name: String.t() | nil,
          tool_call_id: String.t() | nil,
          input: map(),
          content: String.t() | nil,
          is_error: boolean()
        }

  def from_wire(%{"toolName" => tool_name, "toolCallId" => tool_call_id} = payload) do
    {:ok,
     %__MODULE__{
       tool_name: tool_name,
       tool_call_id: tool_call_id,
       input: Map.get(payload, "input", %{}),
       content: Map.get(payload, "content"),
       is_error: Map.get(payload, "isError", false)
     }}
  end

  def from_wire(_payload), do: {:error, :invalid_plugin_hook}
end
