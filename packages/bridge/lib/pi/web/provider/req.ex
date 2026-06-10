defmodule Pi.Web.Provider.Req do
  @moduledoc "Req-backed bounded fetch provider for `Pi.Web`."

  @behaviour Pi.Web.Provider

  alias Pi.Web.Result

  @max_response_size 2 * 1024 * 1024
  @default_timeout_ms 15_000
  @max_timeout_ms 60_000
  @default_max_output_chars 20_000

  @impl true
  def fetch(url, opts) when is_binary(url) and is_list(opts) do
    with :ok <- validate_url(url) do
      context = %{
        original_url: url,
        opts: opts,
        timeout: opts |> Keyword.get(:timeout, @default_timeout_ms) |> normalize_timeout(),
        format: opts |> Keyword.get(:format, :text) |> normalize_format(),
        max_redirects: opts |> Keyword.get(:max_redirects, 5) |> normalize_redirect_limit(),
        redirect_count: 0,
        headers: request_headers(Keyword.get(opts, :headers, %{}))
      }

      request(url, context)
    end
  end

  defp request(url, context) do
    Req.get(
      url,
      Keyword.merge(Keyword.get(context.opts, :req_options, []),
        headers: context.headers,
        redirect: false,
        receive_timeout: context.timeout,
        retry: false
      )
    )
    |> handle_response(url, context)
  end

  defp handle_response({:ok, %{status: status} = response}, current_url, context)
       when status in [301, 302, 303, 307, 308] do
    with {:ok, location} <- redirect_location(response),
         true <- context.redirect_count < context.max_redirects do
      next_url = current_url |> URI.parse() |> URI.merge(URI.parse(location)) |> URI.to_string()

      request(next_url, %{
        context
        | headers: redirect_headers(context.headers, current_url, next_url),
          redirect_count: context.redirect_count + 1
      })
    else
      false -> {:error, {:too_many_redirects, context.max_redirects}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp handle_response({:ok, %{status: status} = response}, current_url, context)
       when status in 200..299 do
    content_type = content_type(response)
    body = normalize_body(response.body)
    size = byte_size(body)

    cond do
      size > @max_response_size ->
        {:error, {:response_too_large, size, @max_response_size}}

      pdf?(content_type, current_url) ->
        {:error, :pdf_fetch_not_supported}

      true ->
        build_result(response, context.original_url, current_url, body, content_type, context)
    end
  end

  defp handle_response({:ok, %{status: status, body: body}}, _current_url, _context) do
    {:error, {:http_error, status, normalize_body(body)}}
  end

  defp handle_response({:error, reason}, _current_url, _context), do: {:error, reason}

  defp build_result(response, url, final_url, body, content_type, context) do
    with {:ok, converted, actual_format} <- convert(body, content_type, context.format) do
      {text, truncated?, total_chars} = truncate(converted, context.opts)

      {:ok,
       %Result{
         url: url,
         final_url: final_url,
         status: response.status,
         content_type: content_type,
         format: actual_format,
         title: title(body, content_type),
         text: text,
         size_bytes: byte_size(body),
         total_chars: total_chars,
         truncated?: truncated?,
         redirected?: final_url != url,
         metadata: %{}
       }}
    end
  end

  defp convert(body, _content_type, :html), do: {:ok, body, :html}

  defp convert(body, content_type, :json) do
    if json?(content_type) do
      case Jason.decode(body) do
        {:ok, decoded} -> {:ok, Jason.encode!(decoded, pretty: true), :json}
        {:error, reason} -> {:error, {:invalid_json, reason}}
      end
    else
      {:error, {:unexpected_content_type, content_type}}
    end
  end

  defp convert(body, content_type, :markdown) do
    if html?(content_type) do
      {:ok, html_to_text(body), :markdown}
    else
      {:ok, body, :markdown}
    end
  end

  defp convert(body, content_type, :text) do
    if html?(content_type), do: {:ok, html_to_text(body), :text}, else: {:ok, body, :text}
  end

  defp truncate(text, opts) do
    max_chars = opts |> Keyword.get(:max_output_chars, @default_max_output_chars) |> max(0)
    total_chars = String.length(text)

    if total_chars > max_chars do
      {String.slice(text, 0, max_chars), true, total_chars}
    else
      {text, false, total_chars}
    end
  end

  defp validate_url(url) do
    case URI.parse(url) do
      %URI{scheme: scheme, host: host} when scheme in ["http", "https"] and is_binary(host) ->
        :ok

      _uri ->
        {:error, :invalid_url}
    end
  end

  defp normalize_timeout(timeout) when is_integer(timeout),
    do: timeout |> max(1) |> min(@max_timeout_ms)

  defp normalize_timeout(timeout) when is_float(timeout),
    do: timeout |> trunc() |> normalize_timeout()

  defp normalize_timeout(_timeout), do: @default_timeout_ms

  defp normalize_redirect_limit(limit) when is_integer(limit) and limit >= 0, do: min(limit, 10)
  defp normalize_redirect_limit(_limit), do: 5

  defp normalize_format(format) when format in [:text, :html, :json, :markdown], do: format
  defp normalize_format("text"), do: :text
  defp normalize_format("html"), do: :html
  defp normalize_format("json"), do: :json
  defp normalize_format("markdown"), do: :markdown
  defp normalize_format(_format), do: :text

  defp request_headers(custom_headers) do
    %{
      "user-agent" => "pi_bridge/#{Application.spec(:pi_bridge, :vsn) || "dev"}",
      "accept" => "text/html,application/json,text/plain;q=0.9,*/*;q=0.1",
      "accept-language" => "en-US,en;q=0.9"
    }
    |> Map.merge(normalize_headers(custom_headers))
  end

  defp normalize_headers(headers) when is_map(headers) do
    Map.new(headers, fn {key, value} -> {to_string(key), to_string(value)} end)
  end

  defp normalize_headers(headers) when is_list(headers) do
    Map.new(headers, fn {key, value} -> {to_string(key), to_string(value)} end)
  end

  defp normalize_headers(_headers), do: %{}

  defp redirect_location(response) do
    response.headers
    |> Map.get("location", [])
    |> List.wrap()
    |> List.first()
    |> case do
      nil -> {:error, :missing_redirect_location}
      "" -> {:error, :missing_redirect_location}
      location -> {:ok, location}
    end
  end

  defp redirect_headers(headers, from_url, to_url) do
    if same_origin?(from_url, to_url),
      do: headers,
      else: Map.drop(headers, ["authorization", "cookie"])
  end

  defp same_origin?(left, right) do
    left = URI.parse(left)
    right = URI.parse(right)
    {left.scheme, left.host, left.port} == {right.scheme, right.host, right.port}
  end

  defp normalize_body(nil), do: ""
  defp normalize_body(body) when is_binary(body), do: body
  defp normalize_body(body), do: Jason.encode!(body)

  defp content_type(response) do
    response.headers
    |> Map.get("content-type", [""])
    |> List.wrap()
    |> List.first()
    |> to_string()
  end

  defp html?(content_type), do: content_type |> String.downcase() |> String.contains?("text/html")

  defp json?(content_type) do
    content_type = String.downcase(content_type)
    String.contains?(content_type, "application/json") or String.contains?(content_type, "+json")
  end

  defp pdf?(content_type, url) do
    content_type = String.downcase(content_type)

    String.contains?(content_type, "application/pdf") or
      String.ends_with?(String.downcase(url), ".pdf")
  end

  defp title(body, content_type) do
    if html?(content_type) do
      case Regex.run(~r/<title[^>]*>(.*?)<\/title>/is, body, capture: :all_but_first) do
        [title] -> title |> html_entities() |> String.replace(~r/\s+/, " ") |> String.trim()
        _none -> nil
      end
    end
  end

  defp html_to_text(html) do
    html
    |> String.replace(~r/<(script|style|noscript|template)[^>]*>.*?<\/\1>/is, " ")
    |> String.replace(~r/<br\s*\/?>/i, "\n")
    |> String.replace(~r/<\/(p|div|section|article|main|header|footer|h[1-6]|li)>/i, "\n")
    |> String.replace(~r/<[^>]+>/, " ")
    |> html_entities()
    |> String.replace(~r/[ \t]+/, " ")
    |> String.replace(~r/\n\s+/, "\n")
    |> String.replace(~r/\n{3,}/, "\n\n")
    |> String.trim()
  end

  defp html_entities(text) do
    text
    |> String.replace("&nbsp;", " ")
    |> String.replace("&amp;", "&")
    |> String.replace("&lt;", "<")
    |> String.replace("&gt;", ">")
    |> String.replace("&quot;", "\"")
    |> String.replace("&#39;", "'")
  end
end
