defmodule Pi.Protocol.Tool.AST.ReplaceTest do
  use ExUnit.Case, async: true

  alias Pi.Protocol.Tool.AST.Diff
  alias Pi.Protocol.Tool.AST.Replace
  alias Pi.Protocol.Tool.AST.Replacement

  test "encodes dry_run as a JSON boolean" do
    assert %{
             "kind" => "ast_replace",
             "dry_run" => true,
             "replacements" => [%{"file" => "lib/demo.ex", "count" => 1}],
             "diffs" => [%{"semantic_edits" => [%{"summary" => "changed public run/0"}]}]
           } =
             Replace.to_map(%Replace{
               dry_run: true,
               pattern: "_",
               replacement: "_",
               replacements: [%Replacement{file: "lib/demo.ex", count: 1}],
               diffs: [
                 %Diff{
                   file: "lib/demo.ex",
                   semantic_edits: [
                     %{
                       op: :update,
                       kind: :function,
                       summary: "changed public run/0",
                       line: 1
                     }
                   ]
                 }
               ],
               total: 1
             })
  end
end
