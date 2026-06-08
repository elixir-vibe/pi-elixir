defmodule Pi.LLM do
  @moduledoc "BEAM API for model calls backed by the active pi session."

  alias Pi.LLM.Broker

  def complete(messages, opts \\ []) do
    Broker.complete(normalize_messages(messages), opts)
  end

  def complete!(messages, opts \\ []) do
    case complete(messages, opts) do
      {:ok, result} -> result
      {:error, reason} -> raise RuntimeError, message: to_string(reason)
    end
  end

  defp normalize_messages(messages) when is_binary(messages),
    do: [%{role: :user, content: messages}]

  defp normalize_messages(messages) when is_list(messages),
    do: Enum.map(messages, &normalize_message/1)

  defp normalize_message(%{role: role, content: content}), do: %{role: role, content: content}

  defp normalize_message(%{"role" => role, "content" => content}),
    do: %{role: role, content: content}

  defp normalize_message(message) when is_binary(message), do: %{role: :user, content: message}
end
