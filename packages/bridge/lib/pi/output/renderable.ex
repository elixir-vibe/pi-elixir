defprotocol Pi.Output.Renderable do
  @moduledoc "Converts eval-domain values into pi structured output when possible."

  @fallback_to_any true

  @doc "Returns a `Pi.Output` for `value`, or `nil` when the value has no semantic renderer."
  @spec to_output(term(), keyword()) :: Pi.Output.t() | nil
  def to_output(value, opts)
end

defimpl Pi.Output.Renderable, for: Pi.Output do
  def to_output(output, _opts), do: output
end

defimpl Pi.Output.Renderable, for: List do
  def to_output(value, opts), do: Pi.Output.list_output(value, opts)
end

defimpl Pi.Output.Renderable, for: Map do
  def to_output(value, opts), do: Pi.Output.map_output(value, opts)
end

defimpl Pi.Output.Renderable, for: BitString do
  def to_output(value, opts), do: Pi.Output.text(value, opts)
end

defimpl Pi.Output.Renderable, for: Any do
  def to_output(_value, _opts), do: nil
end
