defmodule Pi.Skill.Script do
  @moduledoc "Behaviour and DSL for trusted executable `.skill.exs` files."

  alias Pi.Plugin.API

  @type metadata :: %{
          required(:name) => String.t(),
          optional(:version) => String.t(),
          optional(:description) => String.t(),
          optional(:triggers) => [String.t()],
          optional(:alias) => atom(),
          optional(:examples) => [String.t()]
        }

  @callback metadata() :: metadata()
  @callback markdown() :: String.t()
  @callback apis() :: [API.t() | keyword() | map()]
  @callback prompt_context(map()) :: String.t()
  @callback validate(map()) :: :ok | {:error, term()}

  @optional_callbacks apis: 0, prompt_context: 1, validate: 1

  defmacro __using__(_opts) do
    quote do
      @behaviour Pi.Skill.Script
      import Pi.Skill.Script, only: [skill: 1]
      Module.register_attribute(__MODULE__, :pi_skill, accumulate: false)
      @before_compile Pi.Skill.Script
    end
  end

  defmacro skill(do: block) do
    metadata = parse_skill_block(block, __CALLER__)

    quote do
      @pi_skill unquote(Macro.escape(metadata))
    end
  end

  defmacro __before_compile__(env) do
    metadata = Module.get_attribute(env.module, :pi_skill) || %{}
    markdown = Map.get(metadata, :markdown) || moduledoc_markdown(env.module)
    metadata = Map.delete(metadata, :markdown)
    api = default_api(metadata, env.module)

    quote do
      def metadata, do: unquote(Macro.escape(metadata))
      def markdown, do: unquote(markdown)
      def apis, do: unquote(Macro.escape(api))
      def prompt_context(_context), do: markdown()
      def validate(_context), do: :ok

      defoverridable metadata: 0, markdown: 0, apis: 0, prompt_context: 1, validate: 1
    end
  end

  defp parse_skill_block({:__block__, _meta, expressions}, env) do
    expressions |> Enum.map(&parse_expression(&1, env)) |> Map.new()
  end

  defp parse_skill_block(expression, env), do: Map.new([parse_expression(expression, env)])

  defp parse_expression({name, _meta, [value]}, env)
       when name in [:name, :version, :description, :triggers, :examples, :markdown] do
    {name, Macro.expand(value, env)}
  end

  defp parse_expression({:alias_as, _meta, [value]}, env) do
    {:alias, value |> Macro.expand(env) |> module_alias()}
  end

  defp parse_expression(expression, _env) do
    raise ArgumentError, "unsupported skill DSL expression: #{Macro.to_string(expression)}"
  end

  defp module_alias(module) when is_atom(module) do
    module
    |> Module.split()
    |> List.last()
    |> :erlang.binary_to_atom()
  end

  defp moduledoc_markdown(module) do
    case Module.get_attribute(module, :moduledoc) do
      {_line, markdown} when is_binary(markdown) -> markdown
      markdown when is_binary(markdown) -> markdown
      _other -> ""
    end
  end

  defp default_api(%{name: name, alias: alias_name} = metadata, module)
       when is_binary(name) and is_atom(alias_name) do
    [
      API.new(
        name: name |> String.replace("-", "_") |> :erlang.binary_to_atom(),
        module: module,
        alias: alias_name,
        description: Map.get(metadata, :description, ""),
        examples: Map.get(metadata, :examples, [])
      )
    ]
  end

  defp default_api(_metadata, _module), do: []
end
