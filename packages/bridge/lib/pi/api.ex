defmodule Pi.API do
  @moduledoc "Discoverable BEAM-facing Pi APIs."

  def all do
    [
      %{name: :agent, module: Pi.Agent, functions: functions(Pi.Agent)},
      %{name: :llm, module: Pi.LLM, functions: functions(Pi.LLM)},
      %{name: :bridge_info, module: Pi.Bridge.Info, functions: functions(Pi.Bridge.Info)},
      %{name: :plugin_ui, module: Pi.Plugin.UI, functions: functions(Pi.Plugin.UI)},
      %{name: :plugin_events, module: Pi.Plugin.Event, functions: functions(Pi.Plugin.Event)},
      %{name: :integrations, module: Pi.Integrations, functions: functions(Pi.Integrations)}
    ]
  end

  def all_json, do: Jason.encode!(all())

  defp functions(module) do
    module.__info__(:functions)
    |> Enum.reject(fn {name, _arity} -> name in [:module_info, :__info__] end)
    |> Enum.map(fn {name, arity} -> %{name: name, arity: arity} end)
  end
end
