defmodule Pi.Plugin.Supervisor do
  @moduledoc "DynamicSupervisor for isolated project-local plugin workers."

  use DynamicSupervisor

  alias Pi.Plugin.Worker

  def start_link(opts \\ []) do
    DynamicSupervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  def install do
    case Process.whereis(__MODULE__) do
      nil -> start_link([])
      _pid -> :ok
    end
  end

  def start_plugin(module) when is_atom(module) do
    install()
    DynamicSupervisor.start_child(__MODULE__, Worker.child_spec(module))
  end

  @impl true
  def init(_opts) do
    DynamicSupervisor.init(strategy: :one_for_one)
  end
end
