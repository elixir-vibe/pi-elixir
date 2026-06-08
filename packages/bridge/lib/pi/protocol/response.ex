defmodule Pi.Protocol.Response do
  @moduledoc "Pi-to-BEAM multiplexed response envelope."

  use JSONCodec, fast_path: :json

  defstruct [:type, :id, ok: false, result: nil, error: nil]

  @type t :: %__MODULE__{
          type: atom(),
          id: String.t(),
          ok: boolean(),
          result: term(),
          error: term()
        }

  codec(:type, atom: :existing)

  def to_result(%__MODULE__{ok: true, result: result}), do: {:ok, result}
  def to_result(%__MODULE__{ok: false, error: error}), do: {:error, error}
end
