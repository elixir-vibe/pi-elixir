defmodule Pi.Agent.JobSupervisor do
  @moduledoc "Dynamic supervisor for BEAM-owned agent jobs."

  use DynamicSupervisor

  alias Pi.Supervisor.Install

  def start_link(opts \\ []), do: Install.start_link(__MODULE__, opts)

  def install, do: Install.dynamic(__MODULE__)

  def start_job(job, opts) do
    install()

    DynamicSupervisor.start_child(
      __MODULE__,
      Supervisor.child_spec({Pi.Agent.Job, {job, opts}},
        id: {Pi.Agent.Job, job.id},
        restart: :temporary
      )
    )
  end

  @impl true
  def init(_opts), do: DynamicSupervisor.init(strategy: :one_for_one)
end
