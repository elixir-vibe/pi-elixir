defmodule Pi.MCP.ToolsTest do
  use ExUnit.Case, async: true

  alias Pi.MCP.Tools

  describe "dispatch/2 ex_ast_search" do
    test "requires pattern" do
      assert {:error, "Missing required parameter: pattern"} = Tools.dispatch("ex_ast_search", %{})
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
               "total" => 1
             } = Jason.decode!(json)

      assert source =~ "defmodule Pi.Eval do"
    end
  end

  describe "dispatch/2 ex_ast_replace" do
    test "requires pattern and replacement" do
      assert {:error, "Missing required parameters: pattern and replacement"} =
               Tools.dispatch("ex_ast_replace", %{})
    end

    test "returns structured replacement payload" do
      assert {:ok, json} =
               Tools.dispatch("ex_ast_replace", %{
                 "pattern" => "defmodule _ do _ end",
                 "replacement" => "defmodule _ do _ end",
                 "path" => "lib/pi/eval.ex",
                 "dryRun" => true
               })

      assert %{
               "kind" => "ast_replace",
               "dry_run" => true,
               "path" => "lib/pi/eval.ex",
               "replacements" => [%{"file" => "lib/pi/eval.ex", "count" => 1}],
               "total" => 1
             } = Jason.decode!(json)
    end
  end
end
