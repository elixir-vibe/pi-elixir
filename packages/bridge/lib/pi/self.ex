defmodule Pi.Self do
  @moduledoc """
  Self-introspection facade for pi-elixir eval.

  `Pi.Self` is the compact dashboard/API boundary for asking the running bridge
  about itself: bridge inventory, eval state, sessions, plugins, QuackDB mirror,
  and recall context. Eval preloads `alias Pi.Self, as: Self` for concise use.
  """

  use QuackDB.Ecto

  alias Pi.Bridge.Info
  alias Pi.Plugin.Manager
  alias Pi.Quack
  alias Pi.Skill.Loader, as: SkillLoader

  @default_context_limit 5

  @doc "Returns a compact all-in-one bridge status map."
  def status(opts \\ []) do
    %{
      bridge: info_summary(),
      eval: eval(opts),
      quack: quack(),
      sessions: sessions(),
      plugins: plugins(),
      skills: skills(),
      apis: apis()
    }
  end

  @doc "Returns the full bridge inventory snapshot."
  def info, do: Info.snapshot()

  @doc "Returns compact bridge environment metadata."
  def env do
    %{
      cwd: File.cwd!(),
      mix_project: Mix.Project.config()[:app],
      mix_env: Mix.env(),
      elixir: System.version(),
      otp: System.otp_release(),
      node: Node.self(),
      features: %{
        llm: Pi.Features.llm?(),
        sessions: Pi.Features.sessions?(),
        plugins: Pi.Features.plugins?(),
        mirror: Pi.Features.env_enabled?("PI_ELIXIR_MIRROR"),
        skills: Pi.Features.skills?()
      }
    }
  end

  @doc "Returns loaded runtime/extension API inventory."
  def apis do
    snapshot = Info.snapshot()
    %{runtime: snapshot.apis.runtime, extensions: snapshot.apis.extensions}
  end

  @doc "Returns eval alias/import prelude code."
  def aliases, do: Info.aliases_code()

  @doc "Returns current eval binding metadata."
  def bindings, do: Pi.Eval.bindings()

  @doc "Returns eval status metadata."
  def eval(_opts \\ []) do
    %{
      bindings: bindings(),
      binding_count: length(bindings())
    }
  end

  @doc "Returns active BEAM session snapshots."
  def sessions do
    %{
      active: Pi.Session.snapshots(),
      count: length(Pi.Session.snapshots())
    }
  catch
    :exit, reason -> %{error: Exception.format_exit(reason)}
  end

  @doc "Returns compact QuackDB mirror status."
  def quack do
    Quack.status()
  rescue
    exception in [RuntimeError, QuackDB.Error, DBConnection.ConnectionError] ->
      %{error: Exception.message(exception)}
  end

  @doc "Alias for `quack/0`, emphasizing storage status."
  def storage, do: quack()

  @doc "Returns loaded plugin metadata and commands."
  def plugins do
    if Pi.Features.plugins?() do
      %{
        plugins: Manager.plugins(),
        commands: Manager.commands()
      }
    else
      %{disabled: true}
    end
  rescue
    exception in [RuntimeError, ArgumentError] -> %{error: Exception.message(exception)}
  end

  @doc "Returns discovered executable skills."
  def skills do
    if Pi.Features.skills?(), do: SkillLoader.serializable(), else: []
  rescue
    exception in [RuntimeError, ArgumentError, File.Error, Code.LoadError, CompileError] ->
      %{error: Exception.message(exception)}
  end

  @doc "Returns a compact recall block from mirrored session history."
  def context(query, opts \\ []) when is_binary(query) do
    query
    |> recall(opts)
    |> format_context_block()
  end

  @doc "Returns structured recall rows from mirrored session history."
  def recall(query, opts \\ []) when is_binary(query) do
    import Ecto.Query
    require Quack

    limit = Keyword.get(opts, :limit, @default_context_limit)

    Quack.rebuild_fts!()

    from(e in Pi.Quack.Event,
      where: Quack.matches(e.id, ^query),
      order_by: [desc: Quack.score(e.id, ^query)],
      limit: ^limit,
      select: %{
        score: Quack.score(e.id, ^query),
        id: e.id,
        event_type: e.event_type,
        cwd: e.cwd,
        session_file: e.session_file,
        tool: e.tool_name,
        content: Quack.json_text(e.payload_json, "$.content"),
        payload: e.payload_json
      }
    )
    |> Quack.all()
  rescue
    exception in [RuntimeError, ArgumentError, QuackDB.Error, DBConnection.ConnectionError] ->
      [%{"error" => Exception.message(exception)}]
  end

  defp info_summary do
    snapshot = Info.snapshot()

    %{
      project: snapshot.project,
      version: snapshot.version,
      transport: snapshot.transport,
      plugins: Enum.map(snapshot.plugins, & &1.name),
      commands: Enum.map(snapshot.commands, & &1.name)
    }
  end

  defp format_context_block([%{"error" => error}]),
    do: "<recalled-sessions error=#{inspect(error)} />"

  defp format_context_block([]), do: ""

  defp format_context_block(rows) do
    body =
      rows
      |> Enum.with_index(1)
      |> Enum.map_join("\n\n", fn {row, index} -> format_context_row(index, row) end)

    "<recalled-sessions>\n" <> body <> "\n</recalled-sessions>"
  end

  defp format_context_row(index, row) do
    content = clean_text(row["content"] || row["payload"] || "")
    source = Path.basename(to_string(row["session_file"] || "session"))
    tool = row["tool"] || row["event_type"] || "event"

    [
      Integer.to_string(index),
      ". ",
      source,
      " ",
      to_string(tool),
      " score=",
      format_score(row["score"]),
      "\n",
      truncate(content, 1_200)
    ]
    |> IO.iodata_to_binary()
  end

  defp clean_text(text) do
    text
    |> to_string()
    |> String.replace(~r/\s+/u, " ")
    |> String.trim()
  end

  defp truncate(text, max) when byte_size(text) <= max, do: text
  defp truncate(text, max), do: String.slice(text, 0, max) <> "..."

  defp format_score(score) when is_float(score), do: :erlang.float_to_binary(score, decimals: 3)
  defp format_score(score), do: to_string(score || "?")
end
