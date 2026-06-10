defmodule Pi.Session.Supervisor do
  @moduledoc "Dynamic supervisor for server-owned Pi sessions."

  use DynamicSupervisor

  alias Pi.Supervisor.Install

  def start_link(opts \\ []), do: Install.start_link(__MODULE__, opts)

  def install, do: Install.dynamic(__MODULE__)

  def start_session(opts) when is_list(opts) do
    install()
    DynamicSupervisor.start_child(__MODULE__, {Pi.Session.Worker, opts})
  end

  def workers do
    install()

    __MODULE__
    |> DynamicSupervisor.which_children()
    |> Enum.flat_map(fn
      {:undefined, pid, :worker, [Pi.Session.Worker]} when is_pid(pid) -> [pid]
      _child -> []
    end)
  end

  @impl true
  def init(_opts), do: DynamicSupervisor.init(strategy: :one_for_one)
end
