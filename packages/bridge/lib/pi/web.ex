defmodule Pi.Web do
  @moduledoc "Bounded, provider-neutral web fetch helpers for eval sessions."

  alias Pi.Web.Provider.Req
  alias Pi.Web.Result

  @doc "Fetches a URL with bounded time, redirect, size, and output limits."
  @spec fetch(String.t(), keyword()) :: {:ok, Result.t()} | {:error, term()}
  def fetch(url, opts \\ []) when is_binary(url) and is_list(opts) do
    provider = Keyword.get(opts, :provider, Req)
    provider.fetch(url, Keyword.delete(opts, :provider))
  end

  @doc "Fetches a URL or raises on failure."
  @spec fetch!(String.t(), keyword()) :: Result.t()
  def fetch!(url, opts \\ []) do
    case fetch(url, opts) do
      {:ok, result} -> result
      {:error, reason} -> raise ArgumentError, "web fetch failed: #{inspect(reason)}"
    end
  end
end
