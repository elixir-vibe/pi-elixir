if Code.ensure_loaded?(Oban) do
  defmodule Pi.Integrations.Oban do
    @moduledoc "Oban-specific project status discovery."

    @behaviour Pi.Integration

    def name, do: :oban

    def statuses do
      names = names()
      if names == [], do: [], else: [%{key: :oban, text: "oban #{length(names)}"}]
    end

    defp names do
      for {name, _pid, _type, _modules} <- Supervisor.which_children(Oban.Registry), do: name
    rescue
      _ -> []
    end
  end
end
