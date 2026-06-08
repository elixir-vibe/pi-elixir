defmodule Pi.LogCapture do
  @moduledoc "Bounded Logger capture for embedded pi-elixir sessions."

  use GenServer

  @levels Map.new(~w[emergency alert critical error warning notice info debug]a, &{"#{&1}", &1})

  def start_link(opts \\ []), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  def install do
    case Process.whereis(__MODULE__) do
      nil -> start_link([])
      _pid -> :ok
    end

    :logger.add_handler(__MODULE__, __MODULE__, %{
      formatter: Logger.default_formatter(colors: [enabled: false])
    })
  rescue
    _ -> :ok
  end

  def get_logs(n, opts \\ []) do
    grep = Keyword.get(opts, :grep)
    regex = grep && Regex.compile!(grep, "iu")
    level = Keyword.get(opts, :level)
    level_atom = normalize_level(level)
    GenServer.call(__MODULE__, {:get_logs, n, regex, level_atom})
  end

  def clear_logs, do: GenServer.call(__MODULE__, :clear_logs)

  def log(%{meta: meta, level: level} = event, config) do
    if meta[:pi_mcp] do
      :ok
    else
      %{formatter: {formatter_mod, formatter_config}} = config
      chardata = formatter_mod.format(event, formatter_config)
      GenServer.cast(__MODULE__, {:log, level, IO.chardata_to_string(chardata)})
    end
  end

  @impl true
  def init(opts) do
    {:ok, %{logs: :queue.new(), size: 0, max: Keyword.get(opts, :max, 1024)}}
  end

  @impl true
  def handle_cast({:log, level, message}, state) do
    {logs, size} =
      if state.size >= state.max do
        {_, q} = :queue.out(state.logs)
        {:queue.in({level, message}, q), state.size}
      else
        {:queue.in({level, message}, state.logs), state.size + 1}
      end

    {:noreply, %{state | logs: logs, size: size}}
  end

  @impl true
  def handle_call({:get_logs, n, regex, level_filter}, _from, state) do
    logs = :queue.to_list(state.logs)

    logs =
      if level_filter do
        Enum.filter(logs, fn {level, _} -> level == level_filter end)
      else
        logs
      end

    logs =
      if regex do
        Enum.filter(logs, fn {_, message} -> Regex.match?(regex, message) end)
      else
        logs
      end

    messages = Enum.map(logs, &elem(&1, 1))
    {:reply, Enum.take(messages, -n), state}
  end

  def handle_call(:clear_logs, _from, state) do
    {:reply, :ok, %{state | logs: :queue.new(), size: 0}}
  end

  defp normalize_level(nil), do: nil
  defp normalize_level(level) when is_atom(level), do: level
  defp normalize_level(level) when is_binary(level), do: Map.fetch!(@levels, level)
end
