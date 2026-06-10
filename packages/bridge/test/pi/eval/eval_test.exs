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
    assert %{"columns" => columns, "rows" => [["123", "lib/pi.ex"]]} = Jason.decode!(output)
    assert columns == ["bytes", "path"]
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
