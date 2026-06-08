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

  def new(attrs) when is_map(attrs) do
    struct!(__MODULE__, attrs)
  end
end
