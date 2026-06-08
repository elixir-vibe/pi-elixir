if Code.ensure_loaded?(ReqLLM.Provider) do
  defmodule Pi.ReqLLM.Provider do
    @moduledoc "ReqLLM provider metadata for the active Pi model."

    @behaviour ReqLLM.Provider

    def provider_id, do: :pi

    def prepare_request(:chat, _model, context, opts) do
      case Pi.LLM.complete(context, opts) do
        {:ok, text} ->
          response = %Req.Response{status: 200, body: %{text: text}}

          request =
            Req.new()
            |> Req.Request.append_request_steps(
              pi_complete: fn request -> {request, response} end
            )

          {:ok, request}

        {:error, reason} ->
          {:error, RuntimeError.exception(message: inspect(reason))}
      end
    end

    def prepare_request(_operation, _model, _input, _opts) do
      {:error, RuntimeError.exception(message: "Pi ReqLLM provider only supports chat")}
    end

    def attach(request, _model, _opts), do: request
    def encode_body(request), do: request
    def build_body(_request), do: %{}
    def decode_response({request, response}), do: {request, response}
  end
end
