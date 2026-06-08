defmodule Pi.Bridge.Info do
  @moduledoc "Startup inventory for pi_bridge sessions."

  alias Pi.Skill.Loader

  def snapshot(transport \\ :stdio) do
    %{
      project: Mix.Project.config()[:app],
      transport: transport,
      integrations: Pi.Integrations.loaded(),
      skills: skills(),
      plugins: [],
      endpoints: Pi.Integrations.endpoints()
    }
  end

  defp skills do
    Loader.serializable()
    |> Enum.map(&Map.take(&1, [:name, :path, :module]))
  end
end
