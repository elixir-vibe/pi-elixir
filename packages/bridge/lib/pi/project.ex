defmodule Pi.Project do
  @moduledoc "Project metadata helpers for eval sessions."

  def info do
    config = Mix.Project.config()
    app = Keyword.fetch!(config, :app)

    %{
      app: app,
      root: File.cwd!(),
      mix_env: Mix.env(),
      elixir: System.version(),
      otp: System.otp_release(),
      deps: deps(),
      applications: applications(app)
    }
  end

  defp deps do
    Mix.Project.deps_paths()
    |> Enum.map(fn {app, path} ->
      %{app: app, path: Path.relative_to_cwd(path), vsn: app_vsn(app)}
    end)
    |> Enum.sort_by(& &1.app)
  end

  defp applications(app) do
    Application.load(app)

    app
    |> Application.spec(:applications)
    |> List.wrap()
    |> Enum.sort()
  end

  defp app_vsn(app) do
    case Application.spec(app, :vsn) do
      nil -> nil
      vsn -> List.to_string(vsn)
    end
  end
end
