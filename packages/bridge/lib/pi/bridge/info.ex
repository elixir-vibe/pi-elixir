defmodule Pi.Bridge.Info do
  @moduledoc "Startup inventory for pi_bridge sessions."

  alias Pi.Integrations
  alias Pi.Plugin.Manager
  alias Pi.Skill.Loader

  def snapshot(transport \\ :stdio) do
    %{
      project: Mix.Project.config()[:app],
      transport: transport,
      integrations: Integrations.loaded(),
      skills: skills(),
      plugins: Manager.plugins(),
      endpoints: Integrations.endpoints()
    }
  end

  def apis do
    (Manager.apis() ++ skill_apis())
    |> Enum.uniq_by(&{&1.alias, &1.module})
  end

  def aliases_code do
    apis()
    |> Enum.filter(& &1.alias)
    |> Enum.map_join("\n", fn api -> "alias #{inspect(api.module)}, as: #{api.alias}" end)
  end

  defp skills do
    Loader.serializable()
    |> Enum.map(&Map.take(&1, [:name, :path, :module]))
  end

  defp skill_apis do
    Loader.discover()
    |> Enum.flat_map(& &1.apis)
  end
end
