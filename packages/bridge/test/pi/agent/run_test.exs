defmodule Pi.Agent.RunTest do
  use ExUnit.Case, async: true

  alias Pi.Agent.Run

  test "orchestration run structs carry kind, results, and errors" do
    assert %Run{kind: :parallel, status: :ok, results: [:a]} = Run.ok(:parallel, [:a])

    assert %Run{kind: :chain, status: :error, results: [], error: :boom} =
             Run.error(:chain, [], :boom)
  end
end
