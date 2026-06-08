defmodule Pi.ReqLLM do
  @moduledoc "ReqLLM-facing adapter helpers backed by the active Pi session."

  def install do
    if Code.ensure_loaded?(ReqLLM.Providers) and Code.ensure_loaded?(Pi.ReqLLM.Provider) do
      ReqLLM.Providers.register(Pi.ReqLLM.Provider)
    else
      {:error, :req_llm_unavailable}
    end
  end

  def generate_text(messages, opts \\ []) do
    Pi.LLM.complete(messages, opts)
  end

  def generate_text!(messages, opts \\ []) do
    Pi.LLM.complete!(messages, opts)
  end
end
