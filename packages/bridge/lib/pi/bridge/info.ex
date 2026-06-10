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
    dev: Pi.Dev,
    docs: Pi.Docs,
    web: Pi.Web,
    plugin_ui: Pi.Plugin.UI,
    plugin_events: Pi.Plugin.Event,
    session: Pi.Session,
    eval_sandbox: Pi.Eval.Sandbox,
    integrations: Pi.Integrations
  ]

  def snapshot(transport \\ :stdio) do
    %BridgeInfo{
      project: Mix.Project.config()[:app],
      version: bridge_version(),
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
    @runtime_api_modules
    |> Enum.reject(&runtime_api_disabled?/1)
    |> Enum.map(fn {name, module} ->
      %APIModule{name: name, module: module, functions: runtime_functions(module)}
    end)
  end

  def apis, do: extension_apis()

  def extension_apis do
    (plugin_apis() ++ skill_apis())
    |> Enum.map(&Extension.from_api/1)
    |> Enum.uniq_by(&{&1.alias, &1.module})
  end

  def aliases_code do
    builtin_aliases = [
      "import Ecto.Query",
      "use QuackDB.Ecto",
      "alias Pi.Dev, as: Dev, warn: false",
      "alias Pi.Docs, as: Docs, warn: false",
      "alias Pi.Web, as: Web, warn: false",
      "alias Pi.Self, as: Self, warn: false",
      "alias Pi.Quack, as: Q, warn: false",
      "require Q",
      "alias Pi.Quack.Event, as: E, warn: false",
      "alias Pi.Quack.SessionFile, as: SF, warn: false"
    ]

    extension_aliases =
      extension_apis()
      |> Enum.filter(& &1.alias)
      |> Enum.map(fn api -> "alias #{inspect(api.module)}, as: #{api.alias}" end)

    Enum.join(builtin_aliases ++ extension_aliases, "\n")
  end

  defp runtime_api_disabled?({name, _module}) when name in [:agent, :session],
    do: not Pi.Features.sessions?()

  defp runtime_api_disabled?({:llm, _module}), do: not Pi.Features.llm?()

  defp runtime_api_disabled?({name, _module}) when name in [:plugin_ui, :plugin_events],
    do: not Pi.Features.plugins?()

  defp runtime_api_disabled?(_api), do: false

  defp bridge_version do
    :pi_bridge
    |> Application.spec(:vsn)
    |> to_string()
  end

  defp runtime_functions(module) do
    module.__info__(:functions)
    |> Enum.reject(fn {name, _arity} -> name in [:module_info, :__info__] end)
    |> Enum.map(fn {name, arity} -> %Function{name: name, arity: arity} end)
  end

  defp skills do
    if Pi.Features.skills?() do
      Loader.serializable()
      |> Enum.map(&normalize_skill/1)
    else
      []
    end
  end

  defp plugins do
    if Pi.Features.plugins?() do
      Manager.plugins()
      |> Enum.map(&normalize_plugin/1)
    else
      []
    end
  end

  defp commands do
    if Pi.Features.plugins?() do
      Manager.commands()
      |> Enum.map(&PluginCommand.from_command/1)
    else
      []
    end
  end

  defp endpoints do
    Integrations.endpoints()
    |> Enum.map(&Endpoint.from_map!/1)
  end

  defp normalize_skill(%SkillInfo{} = skill), do: skill
  defp normalize_skill(%{} = skill), do: SkillInfo.from_map!(skill)

  defp normalize_plugin(%PluginInfo{} = plugin), do: plugin
  defp normalize_plugin(%{} = plugin), do: PluginInfo.from_map!(plugin)

  defp plugin_apis do
    if Pi.Features.plugins?(), do: Manager.apis(), else: []
  end

  defp skill_apis do
    if Pi.Features.skills?() do
      Loader.discover()
      |> Enum.flat_map(& &1.apis)
    else
      []
    end
  end
end
