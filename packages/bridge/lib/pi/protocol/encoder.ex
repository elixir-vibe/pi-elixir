defmodule Pi.Protocol.Encoder do
  @moduledoc "Protocol encoder that respects JSONCodec field metadata."

  def to_map(%module{} = struct) do
    if function_exported?(module, :__json_codec_fields__, 0) do
      encode_json_codec(struct, module.__json_codec_fields__())
    else
      struct |> Map.from_struct() |> to_map()
    end
  end

  def to_map(map) when is_map(map) do
    Map.new(map, fn {key, value} -> {encode_key(key), to_map(value)} end)
  end

  def to_map(values) when is_list(values), do: Enum.map(values, &to_map/1)
  def to_map(value) when is_boolean(value), do: value
  def to_map(nil), do: nil
  def to_map(value) when is_atom(value), do: Atom.to_string(value)
  def to_map(value), do: value

  defp encode_json_codec(struct, fields) do
    Map.new(fields, fn %{name: name, json: json} -> {json, to_map(Map.get(struct, name))} end)
  end

  defp encode_key(key) when is_atom(key), do: Atom.to_string(key)
  defp encode_key(key), do: key
end
