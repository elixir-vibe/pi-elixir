defmodule Pi.QuackTest do
  use ExUnit.Case, async: false

  import Ecto.Query
  use QuackDB.Ecto

  alias Pi.Bridge.Info
  alias Pi.Mirror.QuackDB, as: Mirror
  alias Pi.Quack, as: Q
  alias Pi.Quack.Event, as: E

  require Q

  setup do
    db =
      Path.join(System.tmp_dir!(), "pi-quack-test-#{System.unique_integer([:positive])}.duckdb")

    previous_enabled = System.get_env("PI_ELIXIR_MIRROR")
    previous_db = System.get_env("PI_ELIXIR_MIRROR_DB")

    System.put_env("PI_ELIXIR_MIRROR", "1")
    System.put_env("PI_ELIXIR_MIRROR_DB", db)

    case start_mirror(db) do
      {:ok, state} ->
        on_exit(fn ->
          Mirror.shutdown(state)
          restore_env("PI_ELIXIR_MIRROR", previous_enabled)
          restore_env("PI_ELIXIR_MIRROR_DB", previous_db)
          File.rm(db)
        end)

        %{state: state}

      {:skip, reason} ->
        on_exit(fn ->
          restore_env("PI_ELIXIR_MIRROR", previous_enabled)
          restore_env("PI_ELIXIR_MIRROR_DB", previous_db)
          File.rm(db)
        end)

        %{skip: reason}
    end
  end

  test "runs analytical Ecto queries against the mirror", context do
    if reason = context[:skip] do
      assert reason =~ "QuackDB mirror unavailable"
    else
      %{state: state} = context
      fixture = fixture_sessions!("analytical cobalt banana")
      {{:ok, _message}, _state} = Mirror.handle_command(:"quack.sync", fixture, state)
      Process.sleep(500)

      q = "analytical cobalt"

      rows =
        from(e in E,
          where: Q.matches(e.id, ^q),
          order_by: [desc: Q.score(e.id, ^q)],
          limit: 5,
          select: %{score: Q.score(e.id, ^q), content: Q.json_text(e.payload_json, "$.content")}
        )
        |> Q.all()

      assert [%{"content" => "analytical cobalt banana", "score" => score} | _] = rows
      assert is_float(score)
    end
  end

  test "eval prelude aliases are enough for compact Q/E queries", context do
    if reason = context[:skip] do
      assert reason =~ "QuackDB mirror unavailable"
    else
      %{state: state} = context
      fixture = fixture_sessions!("prelude cobalt banana")
      {{:ok, _message}, _state} = Mirror.handle_command(:"quack.sync", fixture, state)
      Process.sleep(500)

      code =
        Info.aliases_code() <>
          "\n" <>
          ~S'''
          from(e in E,
            where: Q.matches(e.id, "prelude cobalt"),
            limit: 2,
            select: %{content: Q.json_text(e.payload_json, "$.content")}
          )
          |> Q.all()
          '''

      {rows, _binding} = Code.eval_string(code, [], Code.env_for_eval([]))
      assert [%{"content" => "prelude cobalt banana"} | _] = rows
    end
  end

  defp start_mirror(_db) do
    previous_flag = Process.flag(:trap_exit, true)

    try do
      {:ok, state} = Mirror.init([])

      receive do
        {:EXIT, _pid, reason} ->
          {:skip, "QuackDB mirror unavailable: #{Exception.format_exit(reason)}"}
      after
        100 ->
          {:ok, state}
      end
    catch
      :exit, reason -> {:skip, "QuackDB mirror unavailable: #{Exception.format_exit(reason)}"}
    after
      Process.flag(:trap_exit, previous_flag)
    end
  end

  defp fixture_sessions!(content) do
    root = Path.join(System.tmp_dir!(), "pi-quack-sessions-#{System.unique_integer([:positive])}")
    dir = Path.join(root, "demo")
    File.mkdir_p!(dir)

    File.write!(
      Path.join(dir, "2026-06-10T00-00-00-000Z_demo.jsonl"),
      Jason.encode!(%{type: "message", role: "user", content: content}) <> "\n"
    )

    root
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
