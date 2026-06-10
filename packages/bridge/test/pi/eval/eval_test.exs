defmodule Pi.EvalTest do
  use ExUnit.Case, async: false

  alias Pi.Eval

  test "run returns inspected successful results" do
    assert {:ok, "2"} = Eval.run("1 + 1")
  end

  test "run marks evaluation exceptions as errors" do
    assert {:error, message} = Eval.run("raise \"boom\"")
    assert message =~ "** (RuntimeError) boom"
  end

  test "run preserves captured IO for successful expressions" do
    assert {:ok, message} = Eval.run(~s|IO.puts("hello")
:ok|)
    assert message =~ "IO:\n\nhello\n"
    assert message =~ "Result:\n\n:ok"
  end

  test "run preserves captured IO for failed expressions" do
    assert {:error, message} = Eval.run(~s|IO.puts("before")
raise "boom"|)
    assert message =~ "IO:\n\nbefore\n"
    assert message =~ "Error:\n\n** (RuntimeError) boom"
  end

  test "structured eval includes exception metadata" do
    assert {:error, payload} = Eval.run_structured("raise \"boom\"")

    assert payload.exception.type == "RuntimeError"
    assert payload.exception.message == "boom"
    assert [%{text: text, origin: origin} | _] = payload.exception.stacktrace
    assert is_binary(text)
    assert is_binary(origin)
  end

  test "structured eval includes compact inspect previews" do
    assert {:ok, payload} = Eval.run_structured("%{bridge: \"0.6.0\", app: :pi_bridge}")

    assert [%Pi.Protocol.Tool.OutputPart{format: :tree, output: output, preview: preview}] =
             payload.parts

    assert output =~ "bridge"
    assert preview == "map with 2 keys"
  end

  test "structured eval renders list of maps as a table part" do
    assert {:ok, payload} = Eval.run_structured("[%{path: \"lib/pi.ex\", bytes: 123}]")

    assert [%Pi.Protocol.Tool.OutputPart{format: :table, output: output, preview: preview}] =
             payload.parts

    assert preview == "1 rows × 2 columns"

    assert %{
             "columns" => columns,
             "rows" => [["123", "lib/pi.ex"]],
             "total_rows" => 1,
             "column_types" => ["integer", "string"],
             "alignments" => ["right", "left"]
           } = Jason.decode!(output)

    assert columns == ["bytes", "path"]
  end

  test "structured eval auto-renders strings through output protocol" do
    assert {:ok, payload} = Eval.run_structured(~s("hello"))

    assert [%Pi.Protocol.Tool.OutputPart{format: :text, output: "hello"}] = payload.parts
    assert payload.result == "\"hello\""
  end

  test "structured eval accepts generic output helper options" do
    assert {:ok, payload} =
             Eval.run_structured(
               ~S|Pi.output([%{path: "lib/pi.ex", bytes: 123}], columns: [:path, :bytes])|
             )

    assert [%Pi.Protocol.Tool.OutputPart{format: :table, output: output}] = payload.parts

    assert %{"columns" => ["path", "bytes"], "rows" => [["lib/pi.ex", "123"]]} =
             Jason.decode!(output)
  end

  test "structured eval auto-renders docs query results through output protocol" do
    assert {:ok, payload} =
             Eval.run_structured(
               "Pi.Docs.module(Pi.Output) |> Pi.Docs.functions() |> Pi.Docs.search(\"table\")"
             )

    assert [%Pi.Protocol.Tool.OutputPart{format: :table, output: output}] = payload.parts
    assert %{"columns" => columns, "rows" => rows} = Jason.decode!(output)
    assert columns == ["module", "kind", "name", "arity", "summary", "line"]
    assert Enum.any?(rows, fn row -> Enum.at(row, 2) == "table" and Enum.at(row, 3) == "2" end)
  end

  test "structured eval auto-renders docs source through output protocol" do
    assert {:ok, payload} =
             Eval.run_structured(
               "Pi.Docs.module(Pi.Output) |> Pi.Docs.function(:table, 2) |> Pi.Docs.source(context: 5)"
             )

    assert [
             %Pi.Protocol.Tool.OutputPart{
               format: :source,
               output: output,
               language: "elixir",
               metadata: metadata
             }
           ] = payload.parts

    assert output =~ "def table(rows"
    assert metadata.start_line <= metadata.end_line
    assert metadata.source =~ "lib/pi/output.ex"
    assert metadata.subject =~ "Pi.Output.table/2"
  end

  test "structured eval accepts explicit output helpers" do
    assert {:ok, payload} = Eval.run_structured("Pi.code(\"IO.puts(:ok)\")")

    assert [
             %Pi.Protocol.Tool.OutputPart{
               format: :source,
               output: "IO.puts(:ok)",
               language: "elixir"
             }
           ] =
             payload.parts

    assert payload.text == "IO.puts(:ok)"
  end
end
