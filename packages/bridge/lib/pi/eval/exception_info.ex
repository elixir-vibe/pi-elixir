defmodule Pi.Eval.ExceptionInfo do
  @moduledoc false

  def payload(kind, reason, stacktrace) do
    exception = Exception.normalize(kind, reason, stacktrace)

    %{
      kind: inspect(kind),
      type: exception_type(exception),
      message: Exception.message(exception),
      stacktrace: Enum.map(stacktrace, &stacktrace_entry/1)
    }
  end

  defp exception_type(%module{}) when is_atom(module), do: inspect(module)

  defp stacktrace_entry(entry) do
    formatted = Exception.format_stacktrace_entry(entry)
    {file, line} = stacktrace_location(entry)

    %{
      text: formatted,
      file: file,
      line: line,
      origin: stacktrace_origin(file, line)
    }
  end

  defp stacktrace_location({_module, _function, _arity_or_args, location})
       when is_list(location) do
    {to_string(location[:file] || ""), location[:line]}
  end

  defp stacktrace_location(_), do: {"", nil}

  defp stacktrace_origin(file, line) when is_binary(file) and file != "" and is_integer(line) do
    "#{file}:#{line}"
  end

  defp stacktrace_origin(_, _), do: nil
end
