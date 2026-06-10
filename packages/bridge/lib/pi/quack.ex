defmodule Pi.Quack do
  @moduledoc """
  Eval-friendly analytical API for the pi-elixir QuackDB session mirror.

  This module is intentionally thin: it gives eval users short aliases, Ecto
  schemas, QuackDB Ecto DSL helpers, and a runner against the built-in mirror.
  Prefer composing normal Ecto queries with `use QuackDB.Ecto` and run them with
  `Pi.Quack.all/1`, `Pi.Quack.one/1`, or `Pi.Quack.table/1`.

      import Ecto.Query
      use QuackDB.Ecto
      alias Pi.Quack, as: Q
      require Q
      alias Pi.Quack.Event, as: E

      from(e in Q.errors(),
        where: Q.matches(e.id, ^"function_clause"),
        order_by: [desc: Q.score(e.id, ^"function_clause")],
        limit: 20,
        select: %{score: Q.score(e.id, ^"function_clause"), tool: e.tool_name, payload: e.payload_json}
      )
      |> Q.table()
  """

  import Ecto.Query

  alias Ecto.Adapter.Queryable
  alias Pi.Mirror.QuackDB, as: Mirror
  alias Pi.Plugin.Manager
  alias Pi.Quack.{Event, SessionFile}

  @conn Pi.Mirror.QuackDB.Client
  @events_table "pi_events"
  @fts_schema QuackDB.FTS.schema_name("main.pi_events")

  @doc "Returns code for token-efficient eval aliases/imports."
  def setup do
    """
    import Ecto.Query
    use QuackDB.Ecto
    alias Pi.Self, as: Self
    alias Pi.Quack, as: Q
    require Q
    alias Pi.Quack.Event, as: E
    alias Pi.Quack.SessionFile, as: SF
    """
  end

  @doc "Returns the named QuackDB client used by the built-in mirror."
  def conn do
    ensure!()
    @conn
  end

  @doc "Ensures the built-in QuackDB mirror plugin is loaded and reachable."
  def ensure! do
    if not Mirror.enabled?() do
      raise "QuackDB mirror is disabled; set PI_ELIXIR_MIRROR=1 or unset PI_ELIXIR_MIRROR=0"
    end

    case ping() do
      :ok -> :ok
      {:error, _reason} -> load_and_ping!()
    end
  end

  defp load_and_ping! do
    case Manager.load(Mirror) do
      :ok -> :ok
      {:error, :already_loaded} -> :ok
      {:error, {:already_started, _pid}} -> :ok
      {:error, reason} -> ensure_loaded_after_error!(reason)
    end

    case ping() do
      :ok -> :ok
      {:error, reason} -> raise "QuackDB mirror unavailable: #{Exception.message(reason)}"
    end
  end

  defp ensure_loaded_after_error!(reason) do
    case ping() do
      :ok -> :ok
      {:error, _ping_reason} -> raise "QuackDB mirror unavailable: #{inspect(reason)}"
    end
  end

  defp ping, do: QuackDB.ping(@conn, timeout: 30_000)

  @doc "Runs an Ecto query or raw SQL and returns a `QuackDB.Result`."
  def query!(queryable, opts \\ [])

  def query!(%Ecto.Query{} = query, opts) do
    ensure!()

    {planned_query, _cast_params, dump_params} =
      Queryable.plan_query(:all, Ecto.Adapters.QuackDB, query)

    QuackDB.query!(@conn, Ecto.Adapters.QuackDB.Query.all(planned_query), dump_params, opts)
  end

  def query!(sql, opts) when is_binary(sql) or is_list(sql) do
    ensure!()
    QuackDB.query!(@conn, sql, [], opts)
  end

  @doc "Runs raw SQL with parameters and returns a `QuackDB.Result`."
  def sql!(sql, params \\ [], opts \\ []) do
    ensure!()
    QuackDB.query!(@conn, sql, params, opts)
  end

  @doc "Runs an Ecto query or raw SQL and returns row maps with string keys."
  def all(queryable, opts \\ []) do
    queryable
    |> query!(opts)
    |> result_maps()
  end

  @doc "Returns the first row map from an Ecto query or raw SQL."
  def one(queryable, opts \\ []) do
    queryable
    |> all(opts)
    |> List.first()
  end

  @doc "Runs a query and renders the result as a structured eval table."
  def table(queryable, opts \\ []) do
    queryable
    |> all(Keyword.drop(opts, [:preview, :columns]))
    |> Pi.Output.table(opts)
  end

  @doc "Base Ecto query for mirrored events."
  def events, do: from(e in Event)

  @doc "Base Ecto query for imported session JSONL entries."
  def entries, do: from(e in Event, where: e.event_type == "session_entry")

  @doc "Base Ecto query for mirrored tool calls."
  def tool_calls, do: from(e in Event, where: e.event_type == "tool_call_hook")

  @doc "Base Ecto query for mirrored tool results."
  def tool_results, do: from(e in Event, where: e.event_type == "tool_result_hook")

  @doc "Base Ecto query for rows marked as errors."
  def errors, do: from(e in Event, where: e.is_error == true)

  @doc "Base Ecto query for synced session file metadata."
  def files, do: from(f in SessionFile)

  @doc "DuckDB FTS BM25 score expression for `pi_events`."
  defmacro score(id_expression, query) do
    quote do
      search_score(unquote(@fts_schema), unquote(id_expression), unquote(query))
    end
  end

  @doc "DuckDB FTS boolean match expression for `pi_events`."
  defmacro matches(id_expression, query) do
    quote do
      search_score(unquote(@fts_schema), unquote(id_expression), unquote(query)) > 0
    end
  end

  @doc "DuckDB JSON extraction expression."
  defmacro json(payload_expression, path) do
    quote do
      fragment("json_extract(?, ?)", unquote(payload_expression), unquote(path))
    end
  end

  @doc "DuckDB JSON scalar text extraction expression."
  defmacro json_text(payload_expression, path) do
    quote do
      fragment("json_extract_string(?, ?)", unquote(payload_expression), unquote(path))
    end
  end

  @doc "The generated DuckDB FTS schema for `pi_events`."
  def fts_schema, do: @fts_schema

  @doc "Returns compact status for the QuackDB mirror."
  def status do
    ensure!()

    %{
      database: mirror_database(),
      events: count!(@events_table),
      session_files: count!("pi_session_files"),
      fts_schema: @fts_schema
    }
  end

  @doc "Rebuilds the FTS index for the mirror events table."
  def rebuild_fts! do
    ensure!()
    QuackDB.query!(@conn, QuackDB.FTS.install())
    QuackDB.query!(@conn, QuackDB.FTS.load())
    QuackDB.query!(@conn, QuackDB.FTS.create_index(@events_table, :id, :all, overwrite: true))
    :ok
  end

  defp count!(table) do
    case QuackDB.query!(@conn, ["SELECT count(*) FROM ", QuackDB.Type.quote_identifier(table)]).rows do
      [[count]] -> count
      _other -> 0
    end
  end

  defp mirror_database do
    System.get_env("PI_ELIXIR_MIRROR_DB") ||
      Path.join([System.user_home!(), ".pi", "elixir", "session-mirror.duckdb"])
  end

  defp result_maps(%QuackDB.Result{columns: columns, rows: rows})
       when is_list(columns) and is_list(rows) do
    keys = QuackDB.Result.disambiguate_columns(columns)
    Enum.map(rows, fn row -> keys |> Enum.zip(row) |> Map.new() end)
  end

  defp result_maps(_result), do: []
end
