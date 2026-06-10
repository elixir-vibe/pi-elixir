defmodule Pi.Eval.StatefulTest do
  use ExUnit.Case, async: false

  alias Pi.Eval

  setup do
    if pid = Process.whereis(Pi.Eval.Supervisor), do: DynamicSupervisor.stop(pid)
    if pid = Process.whereis(Pi.Eval.Registry), do: GenServer.stop(pid)

    dir = Path.join(System.tmp_dir!(), "pi-eval-stateful-#{System.unique_integer([:positive])}")
    File.rm_rf!(dir)
    File.mkdir_p!(dir)

    on_exit(fn -> File.rm_rf!(dir) end)

    %{dir: dir, state_path: Path.join(dir, "leaf.term")}
  end

  test "persists bindings across stateful eval calls", %{state_path: state_path} do
    assert {:ok, payload} =
             Eval.run_structured("x = 41", session_id: "leaf", state_path: state_path)

    assert payload.text == "41"
    assert File.regular?(state_path)
    assert File.regular?(state_path <> ".meta.json")

    assert {:ok, payload} =
             Eval.run_structured("x + 1", session_id: "leaf", state_path: state_path)

    assert payload.text == "42"
  end

  test "restores from an ancestor snapshot into a new leaf", %{dir: dir, state_path: parent_path} do
    child_path = Path.join(dir, "child.term")

    assert {:ok, _payload} =
             Eval.run_structured("x = 10", session_id: "parent", state_path: parent_path)

    assert {:ok, payload} =
             Eval.run_structured("x + 5",
               session_id: "child",
               state_path: child_path,
               restore_path: parent_path
             )

    assert payload.text == "15"
    assert File.regular?(child_path)
  end

  test "restores sidecar snapshot after evaluator restart", %{dir: dir, state_path: parent_path} do
    restored_path = Path.join(dir, "restored.term")

    assert {:ok, _payload} =
             Eval.run_structured("x = 8; y = 7", session_id: "parent", state_path: parent_path)

    stop_eval_processes()

    assert {:ok, payload} =
             Eval.run_structured("x + y",
               session_id: "restored",
               state_path: restored_path,
               restore_path: parent_path
             )

    assert payload.text == "15"
    assert payload.state.loadedPath == parent_path
    assert File.regular?(restored_path)
  end

  test "stateful eval renders structured output helpers", %{state_path: state_path} do
    assert {:ok, payload} =
             Eval.run_structured("Pi.table([%{path: \"lib/pi.ex\", bytes: 123}])",
               session_id: "leaf",
               state_path: state_path
             )

    assert payload.text == "[%{path: \"lib/pi.ex\", bytes: 123}]"

    assert [%Pi.Protocol.Tool.OutputPart{format: :table, preview: "1 rows × 2 columns"}] =
             payload.parts
  end

  test "errors do not replace prior state", %{state_path: state_path} do
    assert {:ok, _payload} =
             Eval.run_structured("x = 1", session_id: "leaf", state_path: state_path)

    assert {:error, _payload} =
             Eval.run_structured("x = 2; raise \"boom\"",
               session_id: "leaf",
               state_path: state_path
             )

    assert {:ok, payload} = Eval.run_structured("x", session_id: "leaf", state_path: state_path)
    assert payload.text == "1"
  end

  test "reset and forget are available from inside eval", %{state_path: state_path} do
    assert {:ok, _payload} =
             Eval.run_structured("x = 1; y = 2", session_id: "leaf", state_path: state_path)

    assert {:ok, _payload} =
             Eval.run_structured("Pi.Eval.forget(:x)", session_id: "leaf", state_path: state_path)

    assert {:error, payload} =
             Eval.run_structured("x", session_id: "leaf", state_path: state_path)

    assert payload.text =~ "CompileError"
    assert {:ok, payload} = Eval.run_structured("y", session_id: "leaf", state_path: state_path)
    assert payload.text == "2"

    assert {:ok, _payload} =
             Eval.run_structured("Pi.Eval.reset()", session_id: "leaf", state_path: state_path)

    assert {:error, payload} =
             Eval.run_structured("y", session_id: "leaf", state_path: state_path)

    assert payload.text =~ "CompileError"
  end

  defp stop_eval_processes do
    if pid = Process.whereis(Pi.Eval.Supervisor), do: DynamicSupervisor.stop(pid)
    if pid = Process.whereis(Pi.Eval.Registry), do: GenServer.stop(pid)
  end
end
