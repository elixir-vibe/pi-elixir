defmodule Pi.Integration do
  @moduledoc "Behaviour for optional pi_bridge project integrations."

  @callback name() :: atom()
  @callback endpoints() :: [map()]
  @callback statuses() :: [map()]

  @optional_callbacks endpoints: 0, statuses: 0
end
