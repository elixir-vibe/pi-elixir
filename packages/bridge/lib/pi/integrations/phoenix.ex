if Code.ensure_loaded?(Phoenix.Endpoint) do
  defmodule Pi.Integrations.Phoenix do
    @moduledoc "Phoenix-specific project status discovery."

    def endpoints do
      for {app, _, _} <- Application.started_applications(),
          endpoint <- Application.get_env(app, :phoenix_endpoint, []) |> List.wrap() do
        %{
          module: inspect(endpoint),
          url: endpoint_url(endpoint),
          port: endpoint_port(endpoint)
        }
      end
    end

    def statuses do
      endpoints()
      |> Enum.filter(& &1.port)
      |> Enum.map(fn endpoint -> %{key: :phoenix, text: "phx :#{endpoint.port}"} end)
    end

    defp endpoint_url(endpoint) do
      case endpoint.config(:url) do
        nil -> nil
        url -> url |> Keyword.put_new(:scheme, "http") |> URI.new!() |> URI.to_string()
      end
    rescue
      _ -> nil
    end

    defp endpoint_port(endpoint) do
      http_port(endpoint) || url_port(endpoint)
    end

    defp http_port(endpoint) do
      endpoint.config(:http)
      |> List.wrap()
      |> Keyword.get(:port)
    rescue
      _ -> nil
    end

    defp url_port(endpoint) do
      endpoint.config(:url)
      |> List.wrap()
      |> Keyword.get(:port)
    rescue
      _ -> nil
    end
  end
end
