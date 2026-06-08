defmodule Pi.Plugin do
  @moduledoc "Behaviour for supervised pi_bridge plugins."

  alias Pi.Plugin.API
  alias Pi.Plugin.Command

  @type tool_call_result :: :ok | {:ok, map()} | {:block, String.t()}
  @type tool_result_result :: :ok | {:ok, map()}
  @type command_result :: {:ok, String.t()} | {:error, String.t()} | String.t()

  @callback init(keyword()) :: {:ok, term()} | {:error, term()} | term()
  @callback handle_event(map(), term()) :: {:noreply, term()} | term()
  @callback apis() :: [API.t() | keyword() | map()]
  @callback commands() :: [Command.t() | keyword() | map()]
  @callback handle_command(atom(), String.t(), term()) ::
              {command_result(), term()} | command_result()
  @callback tool_call(map(), map(), term()) :: {tool_call_result(), term()} | tool_call_result()
  @callback tool_result(map(), map(), term()) ::
              {tool_result_result(), term()} | tool_result_result()
  @callback shutdown(term()) :: :ok | term()

  @optional_callbacks init: 1,
                      handle_event: 2,
                      apis: 0,
                      commands: 0,
                      handle_command: 3,
                      tool_call: 3,
                      tool_result: 3,
                      shutdown: 1

  defmacro __using__(_opts) do
    quote do
      @behaviour Pi.Plugin
      Module.register_attribute(__MODULE__, :pi_plugin_apis, accumulate: true)
      Module.register_attribute(__MODULE__, :pi_plugin_commands, accumulate: true)

      import Pi.Plugin, only: [api: 1, command: 1]

      @before_compile Pi.Plugin

      def init(_opts), do: {:ok, %{}}
      def handle_event(_event, state), do: {:noreply, state}
      def handle_command(_name, _args, state), do: {{:error, "Unknown plugin command"}, state}
      def tool_call(_call, _context, state), do: {:ok, state}
      def tool_result(_result, _context, state), do: {:ok, state}
      def shutdown(_state), do: :ok

      defoverridable init: 1,
                     handle_event: 2,
                     handle_command: 3,
                     tool_call: 3,
                     tool_result: 3,
                     shutdown: 1
    end
  end

  defmacro api(attrs) do
    attrs = expand_attrs(attrs, __CALLER__)

    quote do
      @pi_plugin_apis unquote(Macro.escape(attrs))
    end
  end

  defmacro command(attrs) do
    attrs = expand_attrs(attrs, __CALLER__)

    quote do
      @pi_plugin_commands unquote(Macro.escape(attrs))
    end
  end

  defmacro __before_compile__(env) do
    apis =
      env.module
      |> Module.get_attribute(:pi_plugin_apis)
      |> Enum.reverse()

    commands =
      env.module
      |> Module.get_attribute(:pi_plugin_commands)
      |> Enum.reverse()

    quote do
      def apis do
        unquote(Macro.escape(apis))
        |> Enum.map(&API.new/1)
      end

      def commands do
        unquote(Macro.escape(commands))
        |> Enum.map(&Command.new/1)
      end

      defoverridable apis: 0, commands: 0
    end
  end

  defp expand_attrs(attrs, caller) do
    Enum.map(attrs, fn
      {key, value} when key in [:module, :alias] -> {key, Macro.expand(value, caller)}
      entry -> entry
    end)
  end
end
