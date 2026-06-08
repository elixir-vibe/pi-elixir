defmodule Pi.Protocol.Endpoint do
  @moduledoc "Discovered project endpoint exposed in bridge startup info."

  use JSONCodec, fast_path: :json

  defstruct [:module, :url, :port]

  @type t :: %__MODULE__{
          module: String.t() | nil,
          url: String.t() | nil,
          port: non_neg_integer() | nil
        }
end
