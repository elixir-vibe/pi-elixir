defmodule Pi.Web.Provider do
  @moduledoc "Provider behaviour for bounded web fetch implementations."

  alias Pi.Web.Result

  @callback fetch(String.t(), keyword()) :: {:ok, Result.t()} | {:error, term()}
end
