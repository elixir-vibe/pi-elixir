defmodule Pi.LLM do
  @moduledoc "BEAM API for model calls backed by the active pi session."

  alias Pi.LLM.Broker

  def complete(messages, opts \\ []) do
    Broker.complete(normalize_messages(messages), opts)
  end

  def stream(messages, opts \\ []) do
    messages
    |> normalize_messages()
    |> Broker.stream(opts)
  end

  def complete!(messages, opts \\ []) do
    case complete(messages, opts) do
      {:ok, result} -> result
      {:error, reason} -> raise RuntimeError, message: to_string(reason)
    end
  end

  defp normalize_messages(%ReqLLM.Context{} = context) do
    context.messages
    |> Enum.map(&normalize_message/1)
  end

  defp normalize_messages(messages) when is_binary(messages),
    do: [%{role: :user, content: messages}]

  defp normalize_messages(messages) when is_list(messages),
    do: Enum.map(messages, &normalize_message/1)

  defp normalize_message(%ReqLLM.Message{role: role, content: content}) do
    %{role: role, content: normalize_content(content)}
  end

  defp normalize_message(%{role: role, content: content}),
    do: %{role: role, content: normalize_content(content)}

  defp normalize_message(%{"role" => role, "content" => content}),
    do: %{role: role, content: normalize_content(content)}

  defp normalize_message(message) when is_binary(message), do: %{role: :user, content: message}

  defp normalize_content(content) when is_binary(content), do: content

  defp normalize_content(content) when is_list(content) do
    Enum.map_join(content, "", fn
      %{type: :text, text: text} when is_binary(text) -> text
      %{"type" => "text", "text" => text} when is_binary(text) -> text
      part -> inspect(part)
    end)
  end

  defp normalize_content(content), do: inspect(content)
end
