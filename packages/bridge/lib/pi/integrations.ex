defmodule Pi.Integrations do
  @moduledoc "Optional project integration discovery."

  alias Pi.Protocol.Integration.Status

  def modules do
    loaded_app_modules()
    |> Enum.filter(&integration?/1)
    |> Enum.uniq()
  end

  def loaded, do: Enum.map(modules(), & &1.name())

  def endpoints do
    modules()
    |> Enum.flat_map(&optional(&1, :endpoints))
  end

  def statuses do
    modules()
    |> Enum.flat_map(&optional(&1, :statuses))
    |> Enum.map(&normalize_status/1)
    |> Enum.uniq_by(& &1.key)
  end

  defp loaded_app_modules do
    Application.loaded_applications()
    |> Enum.flat_map(fn {app, _, _} -> application_modules(app) end)
  end

  defp application_modules(app) do
    case :application.get_key(app, :modules) do
      {:ok, modules} -> modules
      :undefined -> []
    end
  end

  defp integration?(module) do
    Code.ensure_loaded?(module) and Pi.Integration in behaviours(module) and
      function_exported?(module, :name, 0)
  end

  defp behaviours(module), do: module.module_info(:attributes) |> Keyword.get(:behaviour, [])

  defp normalize_status(%Status{} = status), do: status
  defp normalize_status(%{} = status), do: Status.from_map!(status)

  defp optional(module, function) do
    if function_exported?(module, function, 0) do
      apply(module, function, [])
    else
      []
    end
  end
end
