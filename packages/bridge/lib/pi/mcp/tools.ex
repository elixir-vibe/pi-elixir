defmodule Pi.MCP.Tools do
  @moduledoc "MCP tool dispatch for the embedded server."

  alias Pi.Protocol.Tool.AST.ReplaceRequest
  alias Pi.Protocol.Tool.AST.SearchRequest
  alias Pi.Protocol.Tool.EvalRequest

  def dispatch("project_eval", %{"mode" => "sandbox"} = args), do: eval(args, structured?: false)
  def dispatch("project_eval", args), do: eval(args, structured?: false)
  def dispatch("project_eval_structured", args), do: eval(args, structured?: true)

  def dispatch("project_eval_sandbox", args),
    do: eval(Map.put(args, "mode", "sandbox"), structured?: false)

  def dispatch("ex_ast_search", args) do
    with {:ok, request} <- decode_request(SearchRequest, args, "pattern or patterns") do
      cond do
        is_map(request.patterns) and map_size(request.patterns) > 0 ->
          request.patterns
          |> Pi.AST.search_many(ast_opts(request))
          |> encode_result()

        is_binary(request.pattern) ->
          request.pattern
          |> Pi.AST.search(ast_opts(request))
          |> encode_result()

        true ->
          {:error, "Missing required parameter: pattern or patterns"}
      end
    end
  end

  def dispatch("ex_ast_replace", args) do
    with {:ok, request} <- decode_request(ReplaceRequest, args, "pattern and replacement") do
      request.pattern
      |> Pi.AST.replace(
        request.replacement,
        Keyword.put(ast_opts(request), :dry_run, request.dry_run)
      )
      |> encode_result()
    end
  end

  def dispatch("pi_session_cancel", %{"id" => id}) when is_binary(id) do
    with {:ok, pid} <- Pi.Session.lookup(id), :ok <- Pi.Session.cancel(pid) do
      {:ok, "ok"}
    else
      {:error, reason} -> {:error, inspect(reason)}
    end
  end

  def dispatch("pi_session_rerun", %{"id" => id} = args) when is_binary(id) do
    timeout = Map.get(args, "timeout", 60_000)

    with {:ok, pid} <- Pi.Session.lookup(id) do
      Pi.Session.rerun(pid, timeout: timeout)
    else
      {:error, reason} -> {:error, inspect(reason)}
    end
  end

  def dispatch("pi_session_snapshots", _args) do
    {:ok, encode_payload(%{sessions: Pi.Session.snapshots()})}
  end

  def dispatch(name, _args), do: {:error, "Unknown tool: #{name}"}

  defp eval(args, opts) do
    with {:ok, request} <- decode_request(EvalRequest, args, "code") do
      timeout = request.timeout || eval_timeout(request.mode)
      run_eval(request, timeout, Keyword.fetch!(opts, :structured?))
    end
  end

  defp run_eval(%EvalRequest{mode: :sandbox, code: code}, timeout, true) do
    code |> Pi.Eval.sandbox(timeout: timeout) |> sandbox_payload() |> encode_result()
  end

  defp run_eval(%EvalRequest{mode: :sandbox, code: code}, timeout, false) do
    code |> Pi.Eval.sandbox(timeout: timeout) |> sandbox_result()
  end

  defp run_eval(%EvalRequest{code: code}, timeout, true) do
    code |> Pi.Eval.run_structured(timeout: timeout) |> encode_result()
  end

  defp run_eval(%EvalRequest{code: code}, timeout, false) do
    Pi.Eval.run(code, timeout: timeout)
  end

  defp eval_timeout(:sandbox), do: 5_000
  defp eval_timeout(:trusted), do: 30_000

  defp decode_request(module, args, missing) do
    case module.from_map(args) do
      {:ok, request} -> {:ok, request}
      {:error, _reason} -> {:error, missing_parameters(missing)}
    end
  end

  defp missing_parameters(missing) do
    label = if String.contains?(missing, " and "), do: "parameters", else: "parameter"
    "Missing required #{label}: #{missing}"
  end

  defp sandbox_payload({:ok, %{stdio: stdio, inspected: inspected}}) do
    parts =
      []
      |> maybe_sandbox_io_part(stdio)
      |> Kernel.++([
        %Pi.Protocol.Tool.OutputPart{format: :inspect, output: inspected, language: "elixir"}
      ])

    {:ok,
     %Pi.Protocol.Tool.Eval{
       io: stdio,
       result: inspected,
       text: sandbox_text(stdio, inspected),
       parts: parts,
       display: %Pi.Protocol.UI.Display{blocks: Enum.map(parts, &sandbox_part_block/1)}
     }}
  end

  defp sandbox_payload({:error, :unavailable}), do: {:error, "Dune sandbox is not available"}
  defp sandbox_payload({:error, message}), do: {:error, message}

  defp maybe_sandbox_io_part(parts, ""), do: parts

  defp maybe_sandbox_io_part(parts, stdio) do
    parts ++ [%Pi.Protocol.Tool.OutputPart{format: :text, output: stdio}]
  end

  defp sandbox_part_block(%Pi.Protocol.Tool.OutputPart{
         format: format,
         output: output,
         language: language
       }) do
    %Pi.Protocol.UI.Block{type: format, text: output, language: language}
  end

  defp sandbox_text("", inspected), do: inspected
  defp sandbox_text(stdio, inspected), do: "IO:\n\n#{stdio}\n\nResult:\n\n#{inspected}"

  defp sandbox_result({:ok, %{stdio: "", inspected: inspected}}), do: {:ok, inspected}

  defp sandbox_result({:ok, %{stdio: stdio, inspected: inspected}}) do
    {:ok, sandbox_text(stdio, inspected)}
  end

  defp sandbox_result({:error, :unavailable}), do: {:error, "Dune sandbox is not available"}
  defp sandbox_result({:error, message}), do: {:error, message}

  defp ast_opts(%{
         path: path,
         inside: inside,
         not_inside: not_inside,
         allow_broad: allow_broad,
         limit: limit
       }) do
    []
    |> maybe_put(:path, path)
    |> maybe_put(:inside, inside)
    |> maybe_put(:not_inside, not_inside)
    |> maybe_put(:allow_broad, allow_broad)
    |> maybe_put(:limit, limit)
  end

  defp maybe_put(opts, _key, nil), do: opts
  defp maybe_put(opts, _key, false), do: opts
  defp maybe_put(opts, key, value), do: Keyword.put(opts, key, value)

  defp encode_result({:ok, payload}), do: {:ok, encode_payload(payload)}

  defp encode_result({:error, payload}) when is_struct(payload),
    do: {:error, encode_payload(payload)}

  defp encode_result({:error, message}), do: {:error, message}

  defp encode_payload(payload) when is_map(payload) do
    payload
    |> Pi.Protocol.Encoder.to_map()
    |> normalize()
    |> Jason.encode!()
  end

  defp normalize(map) when is_map(map) do
    Map.new(map, fn {key, value} -> {key, normalize_value(value)} end)
  end

  defp normalize_value(%_module{} = value) do
    value |> Pi.Protocol.Encoder.to_map() |> normalize()
  end

  defp normalize_value(value) when is_list(value), do: Enum.map(value, &normalize_value/1)
  defp normalize_value(value) when is_map(value), do: normalize(value)

  defp normalize_value(value) when is_atom(value) and not is_boolean(value) and not is_nil(value),
    do: Atom.to_string(value)

  defp normalize_value(value), do: value
end
