defmodule Pi.Bridge.Info do
  @moduledoc "Startup inventory for pi_bridge sessions."

  alias Pi.Integrations
  alias Pi.Plugin.Manager
  alias Pi.Protocol.API.Extension
  alias Pi.Protocol.API.Function
  alias Pi.Protocol.API.Inventory
  alias Pi.Protocol.API.Module, as: APIModule
  alias Pi.Protocol.BridgeInfo
  alias Pi.Protocol.Endpoint
  alias Pi.Protocol.PluginCommand
  alias Pi.Protocol.PluginInfo
  alias Pi.Protocol.SkillInfo
  alias Pi.Skill.Loader

  @runtime_api_modules [
    agent: Pi.Agent,
    llm: Pi.LLM,
    bridge_info: __MODULE__,
    plugin_ui: Pi.Plugin.UI,
    plugin_events: Pi.Plugin.Event,
    session: Pi.Session,
    eval_sandbox: Pi.Eval.Sandbox,
    integrations: Pi.Integrations
  ]

  def snapshot(transport \\ :stdio) do
    %BridgeInfo{
      project: Mix.Project.config()[:app],
      transport: transport,
      integrations: Integrations.loaded(),
      skills: skills(),
      plugins: plugins(),
      commands: commands(),
      endpoints: endpoints(),
      apis: %Inventory{
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
    |> Enum.map(&Extension.from_api/1)
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
    |> Enum.map(fn {name, arity} -> %Function{name: name, arity: arity} end)
  end

  defp skills do
    Loader.serializable()
    |> Enum.map(&normalize_skill/1)
  end

  defp plugins do
    Manager.plugins()
    |> Enum.map(&normalize_plugin/1)
  end

  defp commands do
    Manager.commands()
    |> Enum.map(&PluginCommand.from_command/1)
  end

  defp endpoints do
    Integrations.endpoints()
    |> Enum.map(&Endpoint.from_map!/1)
  end

  defp normalize_skill(%SkillInfo{} = skill), do: skill
  defp normalize_skill(%{} = skill), do: SkillInfo.from_map!(skill)

  defp normalize_plugin(%PluginInfo{} = plugin), do: plugin
  defp normalize_plugin(%{} = plugin), do: PluginInfo.from_map!(plugin)

  defp skill_apis do
    Loader.discover()
    |> Enum.flat_map(& &1.apis)
  end
end
