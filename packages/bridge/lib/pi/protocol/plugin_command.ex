defmodule Pi.Protocol.PluginCommand do
  @moduledoc "Plugin slash command metadata sent to the pi extension."

  use JSONCodec, fast_path: :json

  defstruct [:name, :description, :plugin]

  @type t :: %__MODULE__{
          name: atom() | nil,
          description: String.t() | nil,
          plugin: module() | nil
        }

  codec(:name, atom: :unsafe)
  codec(:plugin, atom: :unsafe)

  def from_command(%Pi.Plugin.Command{} = command) do
    %__MODULE__{name: command.name, description: command.description, plugin: command.plugin}
  end
end
