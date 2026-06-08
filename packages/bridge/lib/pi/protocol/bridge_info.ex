defmodule Pi.Protocol.BridgeInfo do
  @moduledoc "Startup inventory for a pi_bridge session."

  use JSONCodec, fast_path: :json

  alias Pi.Protocol.APIInventory
  alias Pi.Protocol.Endpoint
  alias Pi.Protocol.PluginInfo
  alias Pi.Protocol.SkillInfo

  defstruct [
    :project,
    :transport,
    integrations: [],
    skills: [],
    plugins: [],
    endpoints: [],
    apis: %APIInventory{}
  ]

  @type t :: %__MODULE__{
          project: atom() | nil,
          transport: atom() | nil,
          integrations: [atom()],
          skills: [SkillInfo.t()],
          plugins: [PluginInfo.t()],
          endpoints: [Endpoint.t()],
          apis: APIInventory.t()
        }

  codec(:project, atom: :unsafe)
  codec(:transport, atom: :existing)
  codec(:integrations, atom: :unsafe)
end
