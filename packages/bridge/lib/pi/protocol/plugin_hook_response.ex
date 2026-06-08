defmodule Pi.Protocol.PluginHookResponse do
  @moduledoc "BEAM-to-pi plugin tool hook response."

  use JSONCodec, fast_path: :json

  defstruct [:ok, :block, :error]

  @type t :: %__MODULE__{
          ok: map() | String.t() | nil,
          block: String.t() | nil,
          error: String.t() | nil
        }

  def ok(value \\ %{}), do: %__MODULE__{ok: value}
  def block(reason), do: %__MODULE__{block: reason}
  def error(reason), do: %__MODULE__{error: reason}
end
