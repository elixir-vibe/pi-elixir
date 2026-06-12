defmodule Pi.OutputTest do
  use ExUnit.Case, async: true

  defmodule ExampleStruct do
    defstruct [:name, :child]
  end

  test "tree output renders structs inside nested maps" do
    value = %{items: [%ExampleStruct{name: :ok, child: %{count: 1}}]}

    assert %Pi.Output{} = Pi.Output.tree(value)
  end
end
