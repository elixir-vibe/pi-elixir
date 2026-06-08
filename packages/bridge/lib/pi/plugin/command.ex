defmodule Pi.Plugin.Command do
  @moduledoc "Slash command metadata exposed by a BEAM plugin."

  @enforce_keys [:name]
  defstruct [:name, :description, :plugin]

  @type t :: %__MODULE__{
          name: atom(),
          description: String.t(),
          plugin: module() | nil
        }

  def new(%__MODULE__{} = command), do: command

  def new(attrs) when is_list(attrs), do: attrs |> Map.new() |> new()

  def new(%{name: name} = attrs) when is_atom(name) do
    %__MODULE__{
      name: name,
      description: Map.get(attrs, :description, ""),
      plugin: Map.get(attrs, :plugin)
    }
  end
end
