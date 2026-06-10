defmodule Pi.Host do
  @moduledoc "Small RPC helpers for the current host pi session."

  alias Pi.LLM.Broker

  @timeout 10_000

  @doc "Returns compact metadata for the active host pi session."
  def info(opts \\ []), do: request(:session_info, %{}, opts)

  @doc "Returns model-facing tools currently active in the host pi session."
  def active_tools(opts \\ []), do: request(:active_tools, %{}, opts)

  @doc "Appends a custom entry to the active host pi session."
  def append_entry(custom_type, data \\ %{}, opts \\ [])
      when is_binary(custom_type) and (is_map(data) or is_list(data)) do
    request(:append_entry, %{customType: custom_type, data: custom_data(data)}, opts)
  end

  @doc "Sends a custom message entry to the active host pi session."
  def send_message(custom_type, data \\ %{}, opts \\ [])
      when is_binary(custom_type) and (is_map(data) or is_list(data)) do
    request(:send_message, %{customType: custom_type, data: custom_data(data)}, opts)
  end

  defp custom_data(data) when is_map(data), do: data
  defp custom_data(data) when is_list(data), do: Map.new(data)

  defp request(op, payload, opts) do
    timeout = Keyword.get(opts, :timeout, @timeout)
    Broker.request(op, payload, timeout)
  end
end
