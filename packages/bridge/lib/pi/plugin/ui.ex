defmodule Pi.Plugin.UI do
  @moduledoc "Renderer-neutral UI events emitted from BEAM plugins to pi."

  alias Pi.Protocol.UIEvent

  def set_status(key, text) when is_atom(key) or is_binary(key) do
    emit(%UIEvent{type: :ui, op: :status, key: key, text: text})
  end

  def clear_status(key) when is_atom(key) or is_binary(key) do
    emit(%UIEvent{type: :ui, op: :status, key: key, text: nil})
  end

  def set_progress(key, opts) when is_atom(key) or is_binary(key) do
    emit(%UIEvent{
      type: :ui,
      op: :progress,
      key: key,
      title: Keyword.get(opts, :title),
      current: Keyword.get(opts, :current),
      total: Keyword.get(opts, :total)
    })
  end

  def set_widget(key, lines, opts \\ [])
      when (is_atom(key) or is_binary(key)) and is_list(lines) do
    emit(%UIEvent{
      type: :ui,
      op: :widget,
      key: key,
      lines: lines,
      placement: Keyword.get(opts, :placement, :belowEditor)
    })
  end

  def clear_widget(key) when is_atom(key) or is_binary(key) do
    emit(%UIEvent{type: :ui, op: :widget, key: key, lines: nil})
  end

  def notify(message, opts \\ []) do
    emit(%UIEvent{
      type: :ui,
      op: :notify,
      message: message,
      level: Keyword.get(opts, :type, :info)
    })
  end

  def emit(payload) when is_map(payload) do
    case :persistent_term.get({Pi.Transport.Stdio, :pid}, nil) do
      nil -> :ok
      pid -> send(pid, {:pi_transport_emit, normalize(payload)})
    end
  end

  defp normalize(map) do
    Map.new(map, fn {key, value} -> {key, normalize_value(value)} end)
  end

  defp normalize_value(value) when is_atom(value), do: Atom.to_string(value)
  defp normalize_value(value), do: value
end
