defmodule Pi.Mirror.QuackDB do
  @moduledoc """
  Optional built-in DuckDB mirror for pi session/plugin events.

  Enable with `PI_ELIXIR_MIRROR=quackdb`. The mirror is intentionally not a
  model-facing tool: it is loaded by `Pi.Plugin.Manager` as a built-in plugin and
  receives the same lifecycle/tool-hook events as other BEAM plugins.
  """

  use Pi.Plugin

  alias Pi.Plugin.UI

  @table "pi_events"
  @files_table "pi_session_files"
  @default_batch_size 1
  @sync_batch_size 5_000
  @sync_progress_key :elixir_quack_sync

  @session_fields %{
    "cwd" => :cwd,
    "sessionFile" => :session_file,
    "sessionName" => :session_name,
    "leafId" => :leaf_id
  }

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

  def enabled?, do: Pi.Features.env_enabled?("PI_ELIXIR_MIRROR")

  @impl true
  def init(_opts) do
    if enabled?() do
      start_mirror()
    else
      {:ok, %{enabled?: false}}
    end
  end

  command(name: :quack, description: "Inspect or backfill the built-in QuackDB event mirror")

  @impl true
  def handle_event(event, %{enabled?: true} = state) when is_map(event) do
    state = remember_session(state, event)
    append(state, event_row(event, event["type"] || "event", event))
  end

  def handle_event(_event, state), do: {:noreply, state}

  @impl true
  def handle_command(:quack, args, state) do
    state = ensure_enabled(state)

    args
    |> String.split(~r/\s+/, trim: true)
    |> case do
      ["sync" | rest] -> start_sync(state, rest)
      ["status" | _rest] -> {{:ok, status_text(state)}, state}
      [] -> {{:ok, status_text(state)}, state}
      _other -> {{:error, "Usage: /elixir:quack [status|sync [current|PATH]]"}, state}
    end
  end

  @impl true
  def tool_call(call, context, %{enabled?: true} = state) do
    payload = %{"call" => call, "context" => context}

    state =
      state
      |> remember_session(context)
      |> append_row(%{
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
      state
      |> remember_session(context)
      |> append_row(%{
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

  defp ensure_enabled(%{enabled?: true} = state), do: state

  defp ensure_enabled(state) do
    if enabled?() do
      session_state = Map.take(state, Map.values(@session_fields))

      case start_mirror() do
        {:ok, %{enabled?: true} = next_state} -> Map.merge(next_state, session_state)
        {:ok, next_state} -> next_state
      end
    else
      state
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
    QuackDB.query!(conn, QuackDB.DDL.create_table(@table, @columns, if_not_exists: true))

    QuackDB.query!(
      conn,
      QuackDB.DDL.create_table(@files_table, file_columns(), if_not_exists: true)
    )

    QuackDB.query!(conn, create_session_file_index())

    :ok
  rescue
    exception in [QuackDB.Error, DBConnection.ConnectionError, RuntimeError, ArgumentError] ->
      {:error, exception}
  end

  defp create_session_file_index do
    [
      "CREATE INDEX IF NOT EXISTS ",
      QuackDB.Type.quote_identifier("pi_events_session_entry_file_idx"),
      " ON ",
      QuackDB.Type.quote_identifier(@table),
      "(",
      QuackDB.Type.quote_identifier(:event_type),
      ", ",
      QuackDB.Type.quote_identifier(:session_file),
      ")"
    ]
  end

  defp file_columns do
    [
      {:session_file, :varchar, primary_key: true},
      file_size: :bigint,
      mtime_seconds: :bigint,
      synced_entries: :bigint,
      synced_at: :timestamp
    ]
  end

  defp status_text(%{enabled?: true} = state) do
    session_file = Map.get(state, :session_file) || "none yet"
    db = mirror_database()

    "QuackDB mirror enabled · db=#{db} · session=#{session_file}"
  end

  defp status_text(%{error: error}), do: "QuackDB mirror unavailable · #{error}"
  defp status_text(_state), do: "QuackDB mirror disabled · PI_ELIXIR_MIRROR disables it"

  defp start_sync(%{enabled?: true} = state, args) do
    state = flush(state)

    Task.start(fn -> run_sync(state, args) end)

    {{:ok, "🦆 sync started in background"}, state}
  end

  defp start_sync(state, _args), do: {{:error, status_text(state)}, state}

  defp run_sync(state, args) do
    case sync_files(state, args) do
      {:ok, files} ->
        sync_session_files(state, files)

      {:error, message} ->
        UI.notify(message, type: :error)
        UI.clear_status(@sync_progress_key)
    end
  end

  defp sync_files(_state, []), do: {:ok, discover_session_files()}

  defp sync_files(%{session_file: session_file}, ["current" | _rest])
       when is_binary(session_file) and session_file != "" do
    {:ok, [session_file]}
  end

  defp sync_files(_state, ["current" | _rest]) do
    {:error,
     "No current session file observed yet; use /elixir:quack sync to backfill all sessions."}
  end

  defp sync_files(_state, [path | _rest]) do
    path = Path.expand(path)

    cond do
      File.dir?(path) -> {:ok, session_files_under(path)}
      File.regular?(path) -> {:ok, [path]}
      true -> {:error, "Session path not found: #{path}"}
    end
  end

  defp sync_session_files(_state, []) do
    message = "🦆 synced 0 entries from 0 files"
    UI.notify(message)
    UI.clear_status(@sync_progress_key)
    :ok
  end

  defp sync_session_files(state, files) do
    files = Enum.uniq(files)
    total = length(files)
    started_at = System.monotonic_time(:millisecond)

    UI.set_progress(@sync_progress_key, title: "🦆 sync", current: 0, total: total)
    UI.set_status(@sync_progress_key, "🦆 sync starting · #{total} files")

    {entries, failed} =
      files
      |> Enum.with_index(1)
      |> Enum.reduce({0, 0}, fn {file, index}, {entries, failed} ->
        UI.set_progress(@sync_progress_key,
          title: "🦆 sync #{session_file_label(file)}",
          current: index,
          total: total
        )

        case sync_session_file(state, file, index, total) do
          {:ok, count} ->
            synced = entries + count

            UI.set_status(
              @sync_progress_key,
              "🦆 sync · #{index}/#{total} files · #{synced} rows"
            )

            {synced, failed}

          :skipped ->
            UI.set_status(
              @sync_progress_key,
              "🦆 sync · #{index}/#{total} files · skipped unchanged · #{entries} rows"
            )

            {entries, failed}

          {:error, _reason} ->
            UI.set_status(
              @sync_progress_key,
              "🦆 sync · #{index}/#{total} files · #{failed + 1} failed"
            )

            {entries, failed + 1}
        end
      end)

    elapsed = max(System.monotonic_time(:millisecond) - started_at, 1)
    ok_files = total - failed
    rows_per_second = div(entries * 1_000, elapsed)

    message =
      "🦆 synced #{entries} entries from #{ok_files}/#{total} files · #{rows_per_second} rows/s"

    UI.notify(message)
    UI.clear_status(@sync_progress_key)
    :ok
  rescue
    exception in [File.Error, RuntimeError, QuackDB.Error, DBConnection.ConnectionError] ->
      message = Exception.message(exception)
      UI.notify("🦆 sync failed · #{message}", type: :error)
      UI.clear_status(@sync_progress_key)
      :ok
  end

  defp sync_session_file(state, session_file, index, total) do
    if File.regular?(session_file) do
      sync_regular_session_file(state, session_file, index, total)
    else
      {:error, "Session file not found: #{session_file}"}
    end
  rescue
    exception in [File.Error, RuntimeError, QuackDB.Error, DBConnection.ConnectionError] ->
      {:error, Exception.message(exception)}
  end

  defp sync_regular_session_file(%{conn: conn} = state, session_file, index, total) do
    state = flush(state)
    before_stat = session_file_stat!(session_file)

    if synced_file?(conn, session_file, before_stat) do
      :skipped
    else
      delete_session_entries(state, session_file)

      count =
        session_file
        |> File.stream!(:line, read_ahead: 1_000_000)
        |> Stream.map(&String.trim_trailing(&1, "\n"))
        |> Stream.reject(&(&1 == ""))
        |> Stream.chunk_every(sync_batch_size())
        |> Enum.reduce(0, fn lines, count ->
          QuackDB.insert_columns!(conn, @table, session_entry_columns(session_file, lines),
            columns: @columns,
            timeout: :infinity
          )

          count = count + length(lines)

          UI.set_status(
            @sync_progress_key,
            "🦆 sync #{session_file_label(session_file)} · #{index}/#{total} files · #{count} rows"
          )

          count
        end)

      after_stat = session_file_stat!(session_file)

      if before_stat == after_stat,
        do: remember_synced_file(conn, session_file, after_stat, count)

      {:ok, count}
    end
  end

  defp session_entry_columns(session_file, lines) do
    size = length(lines)
    now = NaiveDateTime.utc_now(:microsecond)
    nils = List.duplicate(nil, size)

    [
      id: Enum.map(1..size, fn _ -> unique_id() end),
      event_type: List.duplicate("session_entry", size),
      cwd: nils,
      session_file: List.duplicate(session_file, size),
      session_name: nils,
      leaf_id: nils,
      turn_index: nils,
      tool_name: nils,
      tool_call_id: nils,
      is_error: List.duplicate(false, size),
      occurred_at: List.duplicate(now, size),
      payload_json: lines
    ]
  end

  defp session_file_stat!(session_file) do
    stat = File.stat!(session_file, time: :posix)
    %{size: stat.size, mtime_seconds: stat.mtime}
  end

  defp synced_file?(conn, session_file, %{size: size, mtime_seconds: mtime_seconds}) do
    rows =
      conn
      |> QuackDB.rows(
        [
          "SELECT 1 FROM ",
          QuackDB.Type.quote_identifier(@files_table),
          " WHERE ",
          QuackDB.Type.quote_identifier(:session_file),
          " = ? AND ",
          QuackDB.Type.quote_identifier(:file_size),
          " = ? AND ",
          QuackDB.Type.quote_identifier(:mtime_seconds),
          " = ? LIMIT 1"
        ],
        [session_file, size, mtime_seconds],
        timeout: :infinity
      )
      |> Enum.take(1)

    rows != []
  end

  defp remember_synced_file(
         conn,
         session_file,
         %{size: size, mtime_seconds: mtime_seconds},
         count
       ) do
    delete_file_metadata(conn, session_file)

    QuackDB.insert_rows!(
      conn,
      @files_table,
      [
        %{
          session_file: session_file,
          file_size: size,
          mtime_seconds: mtime_seconds,
          synced_entries: count,
          synced_at: NaiveDateTime.utc_now(:microsecond)
        }
      ],
      columns: [
        session_file: :varchar,
        file_size: :bigint,
        mtime_seconds: :bigint,
        synced_entries: :bigint,
        synced_at: :timestamp
      ],
      timeout: :infinity
    )

    :ok
  end

  defp discover_session_files do
    session_roots()
    |> Enum.flat_map(&session_files_under/1)
    |> Enum.uniq()
  end

  defp session_roots do
    [
      System.get_env("PI_CODING_AGENT_SESSION_DIR"),
      Path.join([System.user_home!(), ".pi", "agent", "sessions"])
    ]
    |> Enum.reject(&(&1 in [nil, ""]))
    |> Enum.map(&Path.expand/1)
    |> Enum.uniq()
  end

  defp session_files_under(root) do
    root
    |> Path.join("**/*.jsonl")
    |> Path.wildcard()
    |> Enum.filter(&File.regular?/1)
  end

  defp session_file_label(file) do
    file
    |> Path.basename(".jsonl")
    |> String.split("_", parts: 2)
    |> List.last()
  end

  defp delete_session_entries(%{conn: conn}, session_file) do
    QuackDB.query!(
      conn,
      [
        "DELETE FROM ",
        QuackDB.Type.quote_identifier(@table),
        " WHERE ",
        QuackDB.Type.quote_identifier(:event_type),
        " = ? AND ",
        QuackDB.Type.quote_identifier(:session_file),
        " = ?"
      ],
      ["session_entry", session_file],
      timeout: :infinity
    )

    :ok
  end

  defp delete_session_entries(_state, _session_file), do: :ok

  defp delete_file_metadata(conn, session_file) do
    QuackDB.query!(
      conn,
      [
        "DELETE FROM ",
        QuackDB.Type.quote_identifier(@files_table),
        " WHERE ",
        QuackDB.Type.quote_identifier(:session_file),
        " = ?"
      ],
      [session_file],
      timeout: :infinity
    )
  end

  defp remember_session(state, event) when is_map(event) do
    Map.merge(state, session_attrs(event))
  end

  defp session_attrs(event) do
    @session_fields
    |> Map.new(fn {source, target} -> {target, event[source]} end)
    |> Enum.reject(fn {_key, value} -> value in [nil, ""] end)
    |> Map.new()
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

  defp sync_batch_size do
    System.get_env("PI_ELIXIR_MIRROR_SYNC_BATCH_SIZE", Integer.to_string(@sync_batch_size))
    |> String.to_integer()
  end

  defp mirror_wait_timeout do
    System.get_env("PI_ELIXIR_MIRROR_WAIT_TIMEOUT", "10000") |> String.to_integer()
  end

  defp compact_keyword(keyword), do: Enum.reject(keyword, fn {_key, value} -> is_nil(value) end)
end
