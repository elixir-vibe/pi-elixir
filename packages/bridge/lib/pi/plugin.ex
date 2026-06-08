defmodule Pi.Plugin do
  @moduledoc "Behaviour for supervised pi_bridge plugins."

  @callback init(keyword()) :: {:ok, term()} | {:error, term()} | term()
  @callback handle_event(map(), term()) :: {:noreply, term()} | term()
  @callback apis() :: [Pi.Plugin.API.t() | keyword() | map()]

  @optional_callbacks init: 1, handle_event: 2, apis: 0

  defmacro __using__(_opts) do
    quote do
      @behaviour Pi.Plugin

      def init(_opts), do: {:ok, %{}}
      def handle_event(_event, state), do: {:noreply, state}
      def apis, do: []

      defoverridable init: 1, handle_event: 2, apis: 0
    end
  end
end
