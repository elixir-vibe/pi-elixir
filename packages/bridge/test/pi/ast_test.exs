defmodule Pi.ASTTest do
  use ExUnit.Case, async: false

  test "rejects ast-grep metavariables with ExAST syntax guidance" do
    assert {:error, search_error} = Pi.AST.search("$MODULE.__rustq_asts__()")
    assert search_error =~ "valid Elixir, not ast-grep"
    assert search_error =~ "Never use $NAME or $$$ARGS"

    assert {:error, named_error} =
             Pi.AST.search_many(%{"render_calls" => "Render.$FUN($$$ARGS)"})

    assert named_error =~ "Named pattern render_calls"
    assert named_error =~ "lowercase variables"

    assert {:error, replace_error} = Pi.AST.replace("raw_arm!($EXPR)", "raw_arm!(expr)")
    assert replace_error =~ "Invalid ExAST pattern"
  end

  test "accepts lowercase captures and ellipsis as valid ExAST syntax" do
    assert {:ok, result} = Pi.AST.search("module.__rustq_asts__()", path: "test")
    assert result.pattern == "module.__rustq_asts__()"

    assert {:ok, result} = Pi.AST.search("foo(first, ...)", path: "test")
    assert result.pattern == "foo(first, ...)"
  end

  test "finds local helper calls next to a broad import" do
    in_git_repo(fn ->
      File.mkdir_p!("lib")

      File.write!("lib/demo.ex", """
      defmodule Demo do
        import Ecto.Changeset

        def run(a, b, c, d, e), do: ensure_vector_store_mapping(a, b, c, d, e)
        defp ensure_vector_store_mapping(a, b, c, d, e), do: {a, b, c, d, e}
      end
      """)

      assert {:ok, result} =
               Pi.AST.search("ensure_vector_store_mapping(_, _, _, _, _)", path: "lib")

      assert result.total == 2
    end)
  end

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
