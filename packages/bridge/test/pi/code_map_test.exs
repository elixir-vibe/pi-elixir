defmodule Pi.CodeMapTest do
  use ExUnit.Case, async: false

  alias Pi.Bridge.Info
  alias Pi.CodeMap

  setup do
    dir = Path.join(System.tmp_dir!(), "pi-code-map-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(dir, "lib"))

    file = Path.join(dir, "lib/sample.ex")

    File.write!(file, """
    defmodule Sample.CodeMapTarget do
      def public(value) do
        value
        |> helper()
        |> to_string()
      end

      def helper(value) do
        if value in [nil, false], do: :empty, else: {:ok, value}
      end
    end
    """)

    on_exit(fn -> File.rm_rf(dir) end)

    %{source_file: file}
  end

  test "summarizes and resolves functions with Reach", %{source_file: file} do
    project = CodeMap.project(paths: [file])

    assert %{"functions" => functions, "modules" => 1} = CodeMap.summary(project: project)
    assert functions >= 2

    assert %Pi.CodeMap.FunctionRef{target: target, file: ^file} =
             CodeMap.find("public/1", project: project)

    assert target =~ "public/1"

    assert [%{"id" => %{"label" => helper}} | _] =
             CodeMap.callees("public/1", project: project, depth: 1)

    assert helper =~ "helper/1"
  end

  test "returns module-level context for module targets", %{source_file: file} do
    project = CodeMap.project(paths: [file])

    assert %{
             "kind" => ":module",
             "target" => "Sample.CodeMapTarget",
             "module" => %{"file" => ^file, "functions" => 2},
             "functions" => functions
           } = CodeMap.context(Sample.CodeMapTarget, project: project)

    assert Enum.any?(functions, &(&1["target"] =~ "public/1"))
    assert Enum.any?(functions, &(&1["target"] =~ "helper/1"))
  end

  test "reflection returns a recommendation and evidence shape", %{source_file: file} do
    project = CodeMap.project(paths: [file])

    reflection = CodeMap.reflect(project: project, paths: [file])

    assert %Pi.CodeMap.Reflection{} = reflection
    assert reflection.command == "Pi.CodeMap.reflect"
    assert [%Pi.CodeMap.FunctionRef{} | _] = reflection.changed_functions
    assert is_list(reflection.hotspots)
    assert is_list(reflection.smells)
    assert is_binary(reflection.recommendation)
    assert %Pi.Output{} = output = Pi.Output.output(reflection)

    assert [
             %Pi.Protocol.Tool.OutputPart{kind: :text, body: summary},
             %Pi.Protocol.Tool.OutputPart{kind: :tree, title: title}
           ] = output.parts

    assert summary =~ "Changed"
    assert summary =~ "hotspots"
    refute title == "CodeMap reflection"
  end

  test "eval prelude aliases CodeMap" do
    assert Info.aliases_code() =~ "alias Pi.CodeMap, as: CodeMap"
  end
end
