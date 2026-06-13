defmodule Pi.ASTTest do
  use ExUnit.Case, async: false

  test "diff compares a changed file against git HEAD" do
    in_git_repo(fn ->
      File.mkdir_p!("lib")

      File.write!("lib/demo.ex", """
      defmodule Demo do
        def run(value), do: value + 1
      end
      """)

      git!(~w[add lib/demo.ex])
      git!(~w[commit -m initial])

      File.write!("lib/demo.ex", """
      defmodule Demo do
        def run(value), do: value + 2
      end
      """)

      assert %Pi.Output{} = output = Pi.AST.diff(path: "lib/demo.ex")
      assert [part] = output.parts
      assert part.title =~ "Elixir syntax diff:"
      refute part.title =~ "0 AST edit"
      assert part.body =~ "changed public Demo.run/1"
      refute part.body =~ "insert function defmodule"
    end)
  end

  defp in_git_repo(fun) do
    dir = Path.join(System.tmp_dir!(), "pi-ast-diff-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)

    try do
      File.cd!(dir, fn ->
        git!(~w[init])
        git!(~w[config user.email test@example.com])
        git!(~w[config user.name Test])
        fun.()
      end)
    after
      File.rm_rf(dir)
    end
  end

  defp git!(args) do
    assert {_output, 0} = System.cmd("git", args, stderr_to_stdout: true)
  end
end
