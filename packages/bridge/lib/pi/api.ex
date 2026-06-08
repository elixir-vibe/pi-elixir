defmodule Pi.API do
  @moduledoc "Discoverable BEAM-facing Pi APIs."

  alias Pi.Protocol.APIFunction
  alias Pi.Protocol.APIModule

  @api_modules [
    agent: Pi.Agent,
    llm: Pi.LLM,
    bridge_info: Pi.Bridge.Info,
    plugin_ui: Pi.Plugin.UI,
    plugin_events: Pi.Plugin.Event,
    integrations: Pi.Integrations
  ]

  def all do
    Enum.map(@api_modules, fn {name, module} ->
      %APIModule{name: name, module: module, functions: functions(module)}
    end)
  end

  def all_json, do: Jason.encode!(Enum.map(all(), &APIModule.to_map/1))

  defp functions(module) do
    module.__info__(:functions)
    |> Enum.reject(fn {name, _arity} -> name in [:module_info, :__info__] end)
    |> Enum.map(fn {name, arity} -> %APIFunction{name: name, arity: arity} end)
  end
end
