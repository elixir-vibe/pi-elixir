case Code.ensure_compiled(ReqLLM.Provider) do
  {:module, ReqLLM.Provider} ->
    defmodule Pi.ReqLLM.Provider do
      @moduledoc "ReqLLM provider for the active Pi model."

      @behaviour ReqLLM.Provider

      alias Pi.Protocol.LLMMessage
      alias ReqLLM.Context
      alias ReqLLM.Response

      def provider_id, do: :pi

      def prepare_request(:chat, model, %Context{} = context, opts) do
        case Pi.LLM.complete(messages(context), opts) do
          {:ok, text} -> {:ok, request_for(response(model, context, text))}
          {:error, reason} -> {:error, RuntimeError.exception(message: inspect(reason))}
        end
      end

      def prepare_request(:chat, model, messages, opts) do
        with {:ok, context} <- Context.normalize(messages, opts) do
          prepare_request(:chat, model, context, opts)
        end
      end

      def prepare_request(_operation, _model, _input, _opts) do
        {:error, RuntimeError.exception(message: "Pi ReqLLM provider only supports chat")}
      end

      def attach(request, _model, _opts), do: request
      def encode_body(request), do: request
      def build_body(_request), do: %{}
      def decode_response({request, response}), do: {request, response}

      defp messages(%Context{} = context) do
        Enum.map(context.messages, fn message ->
          LLMMessage.from_map!(%{
            role: message.role,
            content: text_content(message.content)
          })
        end)
      end

      defp text_content(content) when is_list(content) do
        Enum.map_join(content, fn
          %{type: :text, text: text} when is_binary(text) -> text
          part -> inspect(part)
        end)
      end

      defp request_for(response) do
        req_response = %Req.Response{status: 200, body: response}

        Req.new()
        |> Req.Request.append_request_steps(
          pi_complete: fn request -> {request, req_response} end
        )
      end

      defp response(model, context, text) do
        message = Context.assistant(text)

        %Response{
          id: "pi_#{System.unique_integer([:positive])}",
          model: model.id || model.model || "current",
          context: Context.append(context, message),
          message: message,
          usage: nil,
          finish_reason: :stop,
          provider_meta: %{provider: :pi}
        }
      end
    end

  _ ->
    :ok
end
