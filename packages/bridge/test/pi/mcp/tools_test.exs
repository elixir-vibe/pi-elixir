defmodule Pi.MCP.ToolsTest do
  use ExUnit.Case, async: false

  alias Pi.MCP.Tools
  alias Pi.Session.Supervisor, as: SessionSupervisor

  setup do
    if pid = Process.whereis(SessionSupervisor), do: Process.exit(pid, :kill)
    Process.sleep(5)
    :ok
  end

  describe "dispatch/2 project_eval_structured" do
    test "returns structured result payload" do
      assert {:ok, json} = Tools.dispatch("project_eval_structured", %{"code" => "1 + 1"})

      assert %{
               "kind" => "eval",
               "io" => "",
               "result" => "2",
               "text" => "2",
               "parts" => [%{"kind" => "inspect", "body" => "2"}],
               "display" => %{"blocks" => [%{"type" => "inspect", "text" => "2"}]}
             } = Jason.decode!(json)
    end

    test "keeps inspected boolean results as strings" do
      assert {:ok, json} = Tools.dispatch("project_eval_structured", %{"code" => "true"})

      assert %{"kind" => "eval", "result" => "true", "text" => "true"} = Jason.decode!(json)
    end

    test "returns structured IO and result payload" do
      assert {:ok, json} =
               Tools.dispatch("project_eval_structured", %{
                 "code" => "IO.puts(\"hi\"); {:ok, :done}"
               })

      assert %{
               "kind" => "eval",
               "io" => "hi\n",
               "result" => "{:ok, :done}",
               "text" => text,
               "parts" => [
                 %{"kind" => "text", "body" => "hi\n"},
                 %{"kind" => "inspect", "body" => "{:ok, :done}"}
               ]
             } = Jason.decode!(json)

      assert text =~ "IO:\n\nhi"
      assert text =~ "Result:\n\n{:ok, :done}"
    end
  end

  describe "dispatch/2 ex_ast_search" do
    test "requires pattern" do
      assert {:error, "Missing required parameter: pattern or patterns"} =
               Tools.dispatch("ex_ast_search", %{})
    end

    test "returns structured search payload" do
      assert {:ok, json} =
               Tools.dispatch("ex_ast_search", %{
                 "pattern" => "defmodule _ do _ end",
                 "path" => "lib/pi/eval.ex"
               })

      assert %{
               "kind" => "ast_search",
               "path" => "lib/pi/eval.ex",
               "matches" => [%{"file" => "lib/pi/eval.ex", "line" => 1, "source" => source}],
               "display" => %{"blocks" => [%{"type" => "location"}, %{"type" => "source"} | _]},
               "total" => 1
             } = Jason.decode!(json)

      assert source =~ "defmodule Pi.Eval do"
    end

    test "returns errors instead of raising for missing files" do
      assert {:error, message} =
               Tools.dispatch("ex_ast_search", %{
                 "pattern" => "def run_structured(_, _) do _ end",
                 "path" => "packages/bridge/lib/pi/eval.ex",
                 "limit" => 5
               })

      assert message =~ "could not read file"
      assert message =~ "packages/bridge/lib/pi/eval.ex"
    end

    test "supports search options and search_many" do
      assert {:ok, json} =
               Tools.dispatch("ex_ast_search", %{
                 "patterns" => %{
                   "module" => "defmodule _ do _ end",
                   "run" => "def run(_, _) do _ end"
                 },
                 "path" => "lib/pi/eval.ex",
                 "limit" => 2,
                 "allowBroad" => true
               })

      assert %{"kind" => "ast_search", "matches" => matches, "total" => total} =
               Jason.decode!(json)

      assert total <= 2
      assert Enum.all?(matches, &Map.has_key?(&1, "source"))
      assert Enum.all?(matches, &Map.has_key?(&1, "pattern"))
      assert Enum.all?(matches, &(&1["pattern"] in ["module", "run"]))
    end
  end

  describe "dispatch/2 private session routes" do
    test "returns snapshots and cancels sessions" do
      assert {:ok, pid} = Pi.Session.start(name: :reviewer)
      id = Pi.Session.state(pid).id

      assert {:ok, json} = Tools.dispatch("pi_session_snapshots", %{})
      assert %{"sessions" => [%{"id" => ^id, "name" => "reviewer"}]} = Jason.decode!(json)

      assert {:ok, "ok"} = Tools.dispatch("pi_session_cancel", %{"id" => id})
      assert Pi.Session.state(pid).status == :cancelled
    end
  end

  describe "dispatch/2 ex_ast_replace" do
    test "requires pattern and replacement" do
      assert {:error, "Missing required parameters: pattern and replacement"} =
               Tools.dispatch("ex_ast_replace", %{})
    end

    test "returns errors instead of raising for missing files" do
      assert {:error, message} =
               Tools.dispatch("ex_ast_replace", %{
                 "pattern" => "def run_structured(_, _) do _ end",
                 "replacement" => "def run_structured(code, opts \\ []) do :ok end",
                 "path" => "packages/bridge/lib/pi/eval.ex",
                 "dryRun" => true
               })

      assert message =~ "could not read file"
      assert message =~ "packages/bridge/lib/pi/eval.ex"
    end

    test "returns structured replacement payload" do
      assert {:ok, json} =
               Tools.dispatch("ex_ast_replace", %{
                 "pattern" => "defp reload_project do _ end",
                 "replacement" => "defp reload_project do :ok end",
                 "path" => "lib/pi/eval.ex",
                 "allowBroad" => true,
                 "dryRun" => true
               })

      assert %{
               "kind" => "ast_replace",
               "dry_run" => true,
               "path" => "lib/pi/eval.ex",
               "replacements" => [%{"file" => "lib/pi/eval.ex", "count" => count}],
               "diffs" => [
                 %{
                   "file" => "lib/pi/eval.ex",
                   "diff" => diff,
                   "semantic_edits" => semantic_edits
                 }
               ],
               "total" => total
             } = Jason.decode!(json)

      assert count > 0
      assert total == count
      assert diff =~ "--- lib/pi/eval.ex"
      assert Enum.any?(semantic_edits, &(&1["kind"] == "function"))
    end
  end
end
