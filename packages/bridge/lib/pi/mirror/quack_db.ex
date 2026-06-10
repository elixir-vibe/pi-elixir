defmodule Pi.Mirror.QuackDB do
  @moduledoc """
  Optional built-in DuckDB mirror for pi session/plugin events.

  Enable with `PI_ELIXIR_MIRROR=quackdb`. The mirror is intentionally not a
  model-facing tool: it is loaded by `Pi.Plugin.Manager` as a built-in plugin and
  receives the same lifecycle/tool-hook events as other BEAM plugins.
  """

  use Pi.Plugin

  @table "pi_events"
  @default_batch_size 1

  @columns [
    id: :varchar,
    event_type: :varchar,
    cwd: :varchar,
    session_file: :varchar,
    session_name: :varchar,
    leaf_id: :varchar,
    turn_index: :bigint,
    tool_name: :varchar,
    tool_call_id: :varchar,
    is_error: :boolean,
    occurred_at: :timestamp,
    payload_json: :varchar
  ]

  def enabled?, do: System.get_env("PI_ELIXIR_MIRROR") == "quackdb"

  @impl true
  def init(_opts) do
    if enabled?() do
      start_mirror()
    else
      {:ok, %{enabled?: false}}
    end
  end

  @impl true
  def handle_event(event, %{enabled?: true} = state) when is_map(event) do
    append(state, event_row(event, event["type"] || "event", event))
  end

  def handle_event(_event, state), do: {:noreply, state}

  @impl true
  def tool_call(call, context, %{enabled?: true} = state) do
    payload = %{"call" => call, "context" => context}

    state =
      append_row(state, %{
        event_type: "tool_call_hook",
        cwd: context["cwd"],
        session_file: context["sessionFile"],
        session_name: context["sessionName"],
        leaf_id: context["leafId"],
        tool_name: call["toolName"],
        tool_call_id: call["toolCallId"],
        is_error: false,
        payload_json: encode_payload(payload)
      })

    {:ok, state}
  end

  def tool_call(_call, _context, state), do: {:ok, state}

  @impl true
  def tool_result(result, context, %{enabled?: true} = state) do
    payload = %{"result" => result, "context" => context}

    state =
      append_row(state, %{
        event_type: "tool_result_hook",
        cwd: context["cwd"],
        session_file: context["sessionFile"],
        session_name: context["sessionName"],
        leaf_id: context["leafId"],
        tool_name: result["toolName"],
        tool_call_id: result["toolCallId"],
        is_error: result["isError"] == true,
        payload_json: encode_payload(payload)
      })

    {:ok, state}
  end

  def tool_result(_result, _context, state), do: {:ok, state}

  @impl true
  def shutdown(%{supervisor: supervisor} = state) when is_pid(supervisor) do
    _state = flush(state)
    if Process.alive?(supervisor), do: Supervisor.stop(supervisor)
    :ok
  catch
    :exit, _reason -> :ok
  end

  def shutdown(_state), do: :ok

  defp start_mirror do
    with :ok <- ensure_quackdb(),
         {:ok, supervisor, conn} <- start_quackdb(),
         :ok <- ensure_schema(conn) do
      {:ok, %{enabled?: true, supervisor: supervisor, conn: conn, buffer: []}}
    else
      {:error, reason} ->
        {:ok, %{enabled?: false, error: inspect(reason)}}
    end
  end

  defp ensure_quackdb do
    case Application.ensure_all_started(:quackdb) do
      {:ok, _apps} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp start_quackdb do
    server_name = __MODULE__.Server
    client_name = __MODULE__.Client
    token = "pi_elixir_mirror_#{System.unique_integer([:positive])}"
    port = mirror_port()
    endpoint = "quack:localhost:#{port}"
    uri = System.get_env("PI_ELIXIR_MIRROR_QUACKDB_URI") || "http://[::1]:#{port}"

    server_opts =
      [
        name: server_name,
        duckdb: mirror_duckdb(),
        database: mirror_database(),
        endpoint: endpoint,
        uri: uri,
        token: mirror_token(token),
        wait_timeout: mirror_wait_timeout(),
        poll_interval: 25
      ]
      |> compact_keyword()

    client_opts =
      [
        name: client_name,
        uri: uri,
        token: mirror_token(token),
        pool_size: mirror_pool_size()
      ]
      |> compact_keyword()

    children =
      if System.get_env("PI_ELIXIR_MIRROR_QUACKDB_URI") do
        [{QuackDB, client_opts}]
      else
        QuackDB.Server.child_specs(server: server_opts, client: client_opts)
      end

    case Supervisor.start_link(children, strategy: :one_for_one) do
      {:ok, supervisor} -> {:ok, supervisor, client_name}
      {:error, reason} -> {:error, reason}
    end
  end

  defp ensure_schema(conn) do
    QuackDB.query!(conn, """
    CREATE TABLE IF NOT EXISTS #{@table} (
      id VARCHAR,
      event_type VARCHAR,
      cwd VARCHAR,
      session_file VARCHAR,
      session_name VARCHAR,
      leaf_id VARCHAR,
      turn_index BIGINT,
      tool_name VARCHAR,
      tool_call_id VARCHAR,
      is_error BOOLEAN,
      occurred_at TIMESTAMP,
      payload_json VARCHAR
    )
    """)

    :ok
  rescue
    exception in [QuackDB.Error, DBConnection.ConnectionError, RuntimeError, ArgumentError] ->
      {:error, exception}
  end

  defp event_row(event, event_type, payload) do
    %{
      event_type: event_type,
      cwd: event["cwd"],
      session_file: event["sessionFile"],
      session_name: event["sessionName"],
      leaf_id: event["leafId"],
      turn_index: event["turnIndex"],
      tool_name: event["name"] || event["toolName"],
      tool_call_id: event["toolCallId"],
      is_error: event["isError"] == true,
      payload_json: encode_payload(payload)
    }
  end

  defp append(state, row), do: {:noreply, append_row(state, row)}

  defp append_row(%{buffer: buffer} = state, row) do
    buffer = [normalize_row(row) | buffer]

    if length(buffer) >= mirror_batch_size() do
      flush(%{state | buffer: buffer})
    else
      %{state | buffer: buffer}
    end
  end

  defp flush(%{conn: conn, buffer: buffer} = state) when buffer != [] do
    rows = Enum.reverse(buffer)
    QuackDB.insert_rows!(conn, @table, rows, columns: @columns, batch_size: mirror_batch_size())
    %{state | buffer: []}
  rescue
    _exception in [QuackDB.Error, DBConnection.ConnectionError, RuntimeError, ArgumentError] ->
      %{state | buffer: []}
  end

  defp flush(state), do: state

  defp normalize_row(row) do
    now = NaiveDateTime.utc_now(:microsecond)

    @columns
    |> Keyword.keys()
    |> Map.new(fn key -> {key, normalize_value(key, Map.get(row, key), now)} end)
  end

  defp normalize_value(:id, nil, _now), do: unique_id()
  defp normalize_value(:occurred_at, nil, now), do: now
  defp normalize_value(:turn_index, value, _now) when is_integer(value), do: value
  defp normalize_value(:turn_index, _value, _now), do: nil
  defp normalize_value(:is_error, value, _now), do: value == true
  defp normalize_value(_key, value, _now) when is_binary(value) or is_nil(value), do: value
  defp normalize_value(_key, value, _now), do: to_string(value)

  defp encode_payload(payload) do
    payload
    |> JSONCodec.dump()
    |> Jason.encode!()
  rescue
    _exception in [Jason.EncodeError, Protocol.UndefinedError, FunctionClauseError, ArgumentError] ->
      inspect(payload, limit: 50, printable_limit: 1_000)
  end

  defp unique_id do
    System.unique_integer([:positive, :monotonic])
    |> Integer.to_string()
  end

  defp mirror_database do
    path =
      System.get_env("PI_ELIXIR_MIRROR_DB") ||
        Path.join([System.user_home!(), ".pi", "elixir", "session-mirror.duckdb"])

    File.mkdir_p!(Path.dirname(path))
    path
  end

  defp mirror_duckdb do
    case System.get_env("PI_ELIXIR_MIRROR_DUCKDB") do
      nil -> :managed
      "managed" -> :managed
      path -> path
    end
  end

  defp mirror_token(default), do: System.get_env("PI_ELIXIR_MIRROR_QUACKDB_TOKEN") || default

  defp mirror_port do
    case System.get_env("PI_ELIXIR_MIRROR_QUACKDB_PORT") do
      nil -> 20_000 + rem(System.unique_integer([:positive]), 30_000)
      port -> String.to_integer(port)
    end
  end

  defp mirror_pool_size do
    System.get_env("PI_ELIXIR_MIRROR_POOL_SIZE", "1") |> String.to_integer()
  end

  defp mirror_batch_size do
    System.get_env("PI_ELIXIR_MIRROR_BATCH_SIZE", Integer.to_string(@default_batch_size))
    |> String.to_integer()
  end

  defp mirror_wait_timeout do
    System.get_env("PI_ELIXIR_MIRROR_WAIT_TIMEOUT", "10000") |> String.to_integer()
  end

  defp compact_keyword(keyword), do: Enum.reject(keyword, fn {_key, value} -> is_nil(value) end)
end
