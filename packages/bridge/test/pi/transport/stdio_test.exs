defmodule Pi.Transport.StdioTest do
  use ExUnit.Case, async: false

  alias Pi.Plugin.Manager
  alias Pi.Transport.Stdio

  setup do
    stop_plugin_processes()
    on_exit(&stop_plugin_processes/0)
    :ok
  end

  test "ignores malformed JSON lines" do
    assert Stdio.__test_handle_line__("not json") == :ok
  end

  test "ignores malformed known protocol payloads" do
    assert Stdio.__test_handle_line__(Jason.encode!(%{type: :call})) == :ok
    assert Stdio.__test_handle_line__(Jason.encode!(%{type: :llm_chunk})) == :ok
  end

  test "plugin commands install built-ins before atom lookup" do
    assert {:ok, text} =
             Stdio.__test_dispatch__("pi_plugin_command", %{"name" => "quack", "args" => "status"})

    assert %{"ok" => message} = Jason.decode!(text)
    assert message =~ "QuackDB mirror"
  end

  defp stop_plugin_processes do
    if pid = Process.whereis(Manager), do: stop_if_alive(pid, &GenServer.stop/1)

    if pid = Process.whereis(Pi.Plugin.Supervisor),
      do: stop_if_alive(pid, &DynamicSupervisor.stop/1)
  end

  defp stop_if_alive(pid, stop) do
    if Process.alive?(pid), do: stop.(pid)
  catch
    :exit, _reason -> :ok
  end
end
