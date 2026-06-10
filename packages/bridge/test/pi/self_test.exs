defmodule Pi.SelfTest do
  use ExUnit.Case, async: false

  alias Pi.Mirror.QuackDB, as: Mirror

  setup do
    db = Path.join(System.tmp_dir!(), "pi-self-test-#{System.unique_integer([:positive])}.duckdb")
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

  test "status reports bridge, eval, quack, sessions, plugins, skills, and apis", context do
    if reason = context[:skip] do
      assert reason =~ "QuackDB mirror unavailable"
    else
      status = Pi.Self.status()

      assert %{bridge: %{version: _}, eval: %{binding_count: _}, quack: %{events: _}} = status
      assert Map.has_key?(status, :sessions)
      assert Map.has_key?(status, :plugins)
      assert Map.has_key?(status, :skills)
      assert Map.has_key?(status, :apis)
    end
  end

  test "context returns a compact recall block", context do
    if reason = context[:skip] do
      assert reason =~ "QuackDB mirror unavailable"
    else
      %{state: state} = context
      fixture = fixture_sessions!("self introspection cobalt banana")
      {{:ok, _message}, _state} = Mirror.handle_command(:"quack.sync", fixture, state)
      Process.sleep(500)

      block = Pi.Self.context("introspection cobalt", limit: 2)

      assert block =~ "<recalled-sessions>"
      assert block =~ "self introspection cobalt banana"
    end
  end

  defp start_mirror(_db) do
    if System.get_env("CI") == "true" do
      {:skip, "QuackDB mirror unavailable in CI"}
    else
      start_mirror_locally()
    end
  end

  defp start_mirror_locally do
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
    root = Path.join(System.tmp_dir!(), "pi-self-sessions-#{System.unique_integer([:positive])}")
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
