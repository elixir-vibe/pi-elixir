defmodule Pi.DocsTest do
  use ExUnit.Case, async: true

  alias Pi.Docs

  test "module docs can be filtered and searched in pipelines" do
    result =
      Pi.Output
      |> Docs.module()
      |> Docs.functions()
      |> Docs.search("table")

    assert %Docs.Result{entries: entries} = result
    assert Enum.any?(entries, &(&1.name == :table and &1.arity == 2))
  end

  test "entries and get expose a minimal Enum-friendly API" do
    entries = Docs.entries(System)

    assert Enum.any?(entries, &(&1.kind == :function and &1.name == :cmd and &1.arity == 3))
    assert %Docs.Entry{kind: :function, name: :cmd, arity: 3} = Docs.get(System, :cmd, 3)
  end

  test "function lookup returns source context" do
    source =
      Pi.Output
      |> Docs.module()
      |> Docs.function(:table, 2)
      |> Docs.source(context: 5)

    assert %Docs.Source{text: text, source: path, start_line: start_line, end_line: end_line} =
             source

    assert text =~ "def table(rows"
    assert path =~ "lib/pi/output.ex"
    assert start_line <= end_line
  end
end
