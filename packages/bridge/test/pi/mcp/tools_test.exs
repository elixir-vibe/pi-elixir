defmodule Pi.MCP.ToolsTest do
  use ExUnit.Case, async: true

  alias Pi.MCP.Tools

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
