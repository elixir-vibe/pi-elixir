defmodule Pi.Integrations.Volt do
  @moduledoc "Volt-specific project status discovery."

  @behaviour Pi.Integration

  alias Pi.Protocol.Integration.Status

  def name, do: :volt

  def statuses do
    case app_version(:volt) do
      {:ok, volt_version} -> [%Status{key: :volt, text: status_text(volt_version)}]
      :error -> []
    end
  end

  defp status_text(volt_version) do
    case app_version(:quickbeam) do
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

  defp app_version(app) do
    Application.load(app)

    case Application.spec(app, :vsn) do
      nil -> :error
      version -> {:ok, to_string(version)}
    end
  end
end
