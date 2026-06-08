defmodule Pi.Session do
  @moduledoc "Small BEAM API for reading and appending pi session state."

  alias Pi.LLM.Broker

  @timeout 10_000

  def info(opts \\ []) do
    request(:session_info, %{}, opts)
  end

  def active_tools(opts \\ []) do
    request(:active_tools, %{}, opts)
  end

  def append_entry(custom_type, data \\ %{}, opts \\ [])
      when is_binary(custom_type) and is_map(data) do
    request(:append_entry, %{customType: custom_type, data: data}, opts)
  end

  defp request(op, payload, opts) do
    timeout = Keyword.get(opts, :timeout, @timeout)
    Broker.request(op, payload, timeout)
  end
end
