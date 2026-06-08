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
end
