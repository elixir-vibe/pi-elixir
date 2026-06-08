defmodule Pi.Plugin.WaitersTest do
  use ExUnit.Case, async: false

  alias Pi.Plugin.Waiters

  @table :pi_plugin_waiters_test

  setup do
    if pid = Process.whereis(Waiters), do: GenServer.stop(pid)
    if Waiters.table?(@table), do: :ets.delete(@table)
    :ok
  end

  test "registers, pops, and unregisters session waiters" do
    {:ok, _pid} = Waiters.install()

    assert :ok = Waiters.register(@table, "session-1", self())
    assert {:ok, pid} = Waiters.pop(@table, "session-1")
    assert pid == self()
    assert :error = Waiters.pop(@table, "session-1")

    assert :ok = Waiters.register(@table, "session-2", self())
    assert :ok = Waiters.unregister(@table, "session-2")
    assert :error = Waiters.pop(@table, "session-2")
  end
end
