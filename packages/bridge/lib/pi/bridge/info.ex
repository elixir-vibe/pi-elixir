defmodule Pi.Bridge.Info do
  @moduledoc "Startup inventory for pi_bridge sessions."

  alias Pi.Integrations
  alias Pi.Plugin.Manager
  alias Pi.Protocol.APIFunction
  alias Pi.Protocol.APIModule
  alias Pi.Skill.Loader

  @runtime_api_modules [
    agent: Pi.Agent,
    llm: Pi.LLM,
    bridge_info: __MODULE__,
    plugin_ui: Pi.Plugin.UI,
    plugin_events: Pi.Plugin.Event,
    integrations: Pi.Integrations
  ]

  def snapshot(transport \\ :stdio) do
    %{
      project: Mix.Project.config()[:app],
      transport: transport,
      integrations: Integrations.loaded(),
      skills: skills(),
      plugins: Manager.plugins(),
      endpoints: Integrations.endpoints(),
      apis: %{
        runtime: runtime_apis(),
        extensions: extension_apis()
      }
    }
  end

  def runtime_apis do
    Enum.map(@runtime_api_modules, fn {name, module} ->
      %APIModule{name: name, module: module, functions: runtime_functions(module)}
    end)
  end

  def apis, do: extension_apis()

  def extension_apis do
    (Manager.apis() ++ skill_apis())
    |> Enum.uniq_by(&{&1.alias, &1.module})
  end

  def aliases_code do
    extension_apis()
    |> Enum.filter(& &1.alias)
    |> Enum.map_join("\n", fn api -> "alias #{inspect(api.module)}, as: #{api.alias}" end)
  end

  defp runtime_functions(module) do
    module.__info__(:functions)
    |> Enum.reject(fn {name, _arity} -> name in [:module_info, :__info__] end)
    |> Enum.map(fn {name, arity} -> %APIFunction{name: name, arity: arity} end)
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
