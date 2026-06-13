defmodule Pi.Integrations.AppVersion do
  @moduledoc false

  def fetch(app) when is_atom(app) do
    Application.load(app)

    case Application.spec(app, :vsn) do
      nil -> :error
      version -> {:ok, to_string(version)}
    end
  end
end
