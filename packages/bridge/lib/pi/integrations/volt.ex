defmodule Pi.Integrations.Volt do
  @moduledoc "Volt-specific project status discovery."

  @behaviour Pi.Integration

  alias Pi.Integrations.AppVersion
  alias Pi.Protocol.Integration.Status

  def name, do: :volt

  def statuses do
    case AppVersion.fetch(:volt) do
      {:ok, volt_version} -> [%Status{key: :volt, text: status_text(volt_version)}]
      :error -> []
    end
  end

  defp status_text(volt_version) do
    case AppVersion.fetch(:quickbeam) do
      {:ok, quickbeam_version} ->
        "volt #{volt_version} · qb #{quickbeam_version}#{quickbeam_note(quickbeam_version)}"

      :error ->
        "volt #{volt_version}"
    end
  end

  defp quickbeam_note(version) do
    if Version.match?(version, "< 0.10.15") do
      " old"
    else
      ""
    end
  rescue
    Version.InvalidVersionError -> ""
  end
end
