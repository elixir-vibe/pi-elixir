defmodule Pi.Features do
  @moduledoc false

  @disabled_values ~w[0 false off no]

  @features %{
    llm: %{
      env: "PI_ELIXIR_LLM",
      disabled: "BEAM-initiated LLM is disabled."
    },
    sessions: %{
      env: "PI_ELIXIR_SESSIONS",
      disabled: "BEAM sessions are disabled."
    },
    plugins: %{
      env: "PI_ELIXIR_PLUGINS",
      disabled: "Project-local plugins are disabled."
    },
    skills: %{
      env: "PI_ELIXIR_SKILLS",
      disabled: "Executable Elixir skills are disabled."
    }
  }

  defmacro gate(feature, do: block) do
    quote do
      if Pi.Features.enabled?(unquote(feature)) do
        unquote(block)
      else
        {:error, Pi.Features.disabled_message(unquote(feature))}
      end
    end
  end

  def enabled?(feature) when is_atom(feature) do
    feature
    |> env_name()
    |> env_enabled?()
  end

  def env_enabled?(env) when is_binary(env) do
    case System.get_env(env) do
      nil -> true
      value -> String.downcase(String.trim(value)) not in @disabled_values
    end
  end

  def disabled_message(feature) when is_atom(feature) do
    @features
    |> Map.fetch!(feature)
    |> Map.fetch!(:disabled)
  end

  def snapshot do
    Map.new(@features, fn {feature, %{env: env}} ->
      {feature, %{enabled: enabled?(feature), env: env}}
    end)
  end

  def llm?, do: enabled?(:llm)
  def plugins?, do: enabled?(:plugins)
  def sessions?, do: enabled?(:sessions)
  def skills?, do: enabled?(:skills)

  defp env_name(feature) do
    @features
    |> Map.fetch!(feature)
    |> Map.fetch!(:env)
  end
end
