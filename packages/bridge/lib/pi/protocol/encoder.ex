defmodule Pi.Protocol.Encoder do
  @moduledoc "Protocol encoder that respects JSONCodec field metadata."

  def to_map(value), do: JSONCodec.dump(value)
end
