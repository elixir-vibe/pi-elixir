defmodule Pi.Protocol.Tool.OutputPart do
  @moduledoc "Semantic output part for tool renderers."

  use JSONCodec, fast_path: :json

  defstruct [:kind, body: "", title: nil, language: nil, data: %{}, truncation: nil]

  @type kind :: :text | :inspect | :markdown | :code | :error | :diff | :table | :tree
  @type truncation :: :head | :tail | nil

  @type t :: %__MODULE__{
          kind: kind(),
          body: String.t(),
          title: String.t() | nil,
          language: String.t() | nil,
          data: map(),
          truncation: truncation()
        }

  codec(:kind,
    atom: {:enum, [:text, :inspect, :markdown, :code, :error, :diff, :table, :tree]}
  )

  codec(:truncation, atom: {:enum, [:head, :tail]})

  @spec text(String.t(), keyword()) :: t()
  def text(body, opts \\ []) when is_binary(body), do: build(:text, body, opts)

  @spec inspect(String.t(), keyword()) :: t()
  def inspect(body, opts \\ []) when is_binary(body), do: build(:inspect, body, opts)

  @spec markdown(String.t(), keyword()) :: t()
  def markdown(body, opts \\ []) when is_binary(body), do: build(:markdown, body, opts)

  @spec code(String.t(), keyword()) :: t()
  def code(body, opts \\ []) when is_binary(body), do: build(:code, body, opts)

  @spec table(String.t(), keyword()) :: t()
  def table(body, opts \\ []) when is_binary(body), do: build(:table, body, opts)

  @spec tree(String.t(), keyword()) :: t()
  def tree(body, opts \\ []) when is_binary(body), do: build(:tree, body, opts)

  @spec error(String.t(), keyword()) :: t()
  def error(body, opts \\ []) when is_binary(body), do: build(:error, body, opts)

  @spec diff(String.t(), keyword()) :: t()
  def diff(body, opts \\ []) when is_binary(body), do: build(:diff, body, opts)

  defp build(kind, body, opts) do
    %__MODULE__{
      kind: kind,
      body: body,
      title: Keyword.get(opts, :title),
      language: opts |> Keyword.get(:language) |> normalize_language(),
      data: Keyword.get(opts, :data, %{}),
      truncation: Keyword.get(opts, :truncation)
    }
  end

  defp normalize_language(nil), do: nil
  defp normalize_language(language), do: to_string(language)
end
