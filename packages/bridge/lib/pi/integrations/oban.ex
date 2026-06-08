if Code.ensure_loaded?(Oban) do
  defmodule Pi.Integrations.Oban do
    @moduledoc "Oban-specific project status discovery."

    @behaviour Pi.Integration

    alias Pi.Protocol.Integration.Status

    def name, do: :oban

    def statuses do
      names = names()
      if names == [], do: [], else: [%Status{key: :oban, text: "oban #{length(names)}"}]
    end

    defp names do
      for {name, _pid, _type, _modules} <- Supervisor.which_children(Oban.Registry), do: name
    catch
      :exit, _reason -> []
    end
  end
end
