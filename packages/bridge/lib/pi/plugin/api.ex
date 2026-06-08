defmodule Pi.Plugin.API do
  @moduledoc "Callable API metadata exposed by executable skills and plugins."

  @type t :: %__MODULE__{
          name: atom(),
          module: module(),
          alias: atom() | nil,
          description: String.t(),
          examples: [String.t()]
        }

  @enforce_keys [:name, :module]
  defstruct [:name, :module, :alias, description: "", examples: []]

  def new(%__MODULE__{} = api), do: api

  def new(attrs) when is_list(attrs) do
    attrs |> Map.new() |> new()
  end

  def new(%{name: name, module: module} = attrs) when is_atom(name) and is_atom(module) do
    %__MODULE__{
      name: name,
      module: module,
      alias: Map.get(attrs, :alias) || default_alias(module),
      description: Map.get(attrs, :description, ""),
      examples: Map.get(attrs, :examples, [])
    }
  end

  defp default_alias(module) do
    module
    |> Module.split()
    |> Enum.reject(&(&1 in ["Pi", "Plugin", "Plugins", "API"]))
    |> List.last()
    |> :erlang.binary_to_atom()
  end
end
