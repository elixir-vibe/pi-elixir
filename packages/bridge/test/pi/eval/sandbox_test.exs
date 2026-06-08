defmodule Pi.Eval.SandboxTest do
  use ExUnit.Case, async: true

  alias Pi.Eval
  alias Pi.Eval.Sandbox

  test "available? returns true when Dune is installed" do
    assert Sandbox.available?()
  end

  test "evaluates safe expressions" do
    assert {:ok, %{value: 42, inspected: "42"}} = Eval.sandbox("40 + 2")
  end

  test "captures stdio" do
    assert {:ok, %{stdio: "hello\n"}} = Sandbox.eval(~s|IO.puts("hello")|)
  end

  test "blocks filesystem and system access" do
    assert {:error, file_message} = Sandbox.eval("File.cwd!()")
    assert file_message =~ "restricted"

    assert {:error, system_message} = Sandbox.eval(~s|System.cmd("ls", [])|)
    assert system_message =~ "restricted"
  end

  test "enforces memory and reduction limits" do
    assert {:error, memory_message} = Sandbox.eval("List.duplicate(:x, 10_000_000)")
    assert memory_message =~ "memory"

    assert {:error, reduction_message} =
             Sandbox.eval("Enum.reduce(1..10_000_000, 0, &(&1 + &2))",
               max_reductions: 10_000
             )

    assert reduction_message =~ "reductions"
  end
end
