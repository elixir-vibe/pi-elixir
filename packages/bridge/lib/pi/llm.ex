defmodule Pi.LLM do
  @moduledoc "BEAM API for model calls backed by the active pi session."

  require Pi.Features

  alias Pi.LLM.Broker
  alias Pi.Protocol.LLM.Message

  def complete(messages, opts \\ []) do
    with {:ok, result} <- complete_with_usage(messages, opts) do
      {:ok, result_text(result)}
    end
  end

  def complete_with_usage(messages, opts \\ []) do
    Pi.Features.gate :llm do
      messages
      |> normalize_messages()
      |> Broker.complete(opts)
      |> normalize_completion_result()
    end
  end

  def stream(messages, opts \\ []) do
    Pi.Features.gate :llm do
      messages
      |> normalize_messages()
      |> Broker.stream(opts)
    end
  end

  def complete!(messages, opts \\ []) do
    case complete(messages, opts) do
      {:ok, result} -> result
      {:error, reason} -> raise RuntimeError, message: to_string(reason)
    end
  end

  defp normalize_completion_result({:ok, result}), do: {:ok, completion_result(result)}
  defp normalize_completion_result({:error, reason}), do: {:error, reason}

  defp completion_result(%{"text" => text} = result) when is_binary(text) do
    %{text: text, usage: result["usage"], model: result["model"], provider: result["provider"]}
  end

  defp completion_result(%{text: text} = result) when is_binary(text) do
    %{text: text, usage: result[:usage], model: result[:model], provider: result[:provider]}
  end

  defp completion_result(text) when is_binary(text), do: %{text: text, usage: nil}
  defp completion_result(result), do: %{text: inspect(result), usage: nil}

  defp result_text(%{text: text}) when is_binary(text), do: text

  defp normalize_messages(messages) when is_binary(messages),
    do: [Message.from_map!(%{role: :user, content: messages})]

  defp normalize_messages(messages) when is_list(messages),
    do: Enum.map(messages, &normalize_message/1)

  defp normalize_message(%Message{} = message), do: message
  defp normalize_message(%{} = message), do: Message.from_map!(message)

  defp normalize_message(message) when is_binary(message),
    do: Message.from_map!(%{role: :user, content: message})
end
