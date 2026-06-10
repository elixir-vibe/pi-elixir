defmodule Pi.Supervisor.Install do
  @moduledoc false

  def start_link(module, opts) do
    DynamicSupervisor.start_link(module, opts, name: module)
  end

  def dynamic(module) do
    case Process.whereis(module) do
      nil ->
        case module.start_link([]) do
          {:ok, pid} ->
            Process.unlink(pid)
            {:ok, pid}

          other ->
            other
        end

      _pid ->
        :ok
    end
  end
end
