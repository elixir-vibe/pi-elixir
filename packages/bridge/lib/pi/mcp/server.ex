defmodule Pi.MCP.Server do
  @moduledoc "Starts the embedded MCP server inside the project Mix context."

  alias Pi.MCP.Router

  def start!(args \\ System.argv()) do
    port = parse_port(args)

    Pi.LogCapture.install()
    Process.flag(:trap_exit, true)

    {actual_port, http_server} = start_http(port)
    wait_until_accepting(actual_port)
    IO.puts("PI_MCP_READY port=#{actual_port} server=#{http_server}")

    receive do
      :stop -> :ok
    end
  end

  defp parse_port(["--port", port | _]), do: String.to_integer(port)
  defp parse_port(_), do: 4041

  defp start_http(port) do
    {:ok, server} = Bandit.start_link(plug: Router, port: port, ip: :loopback)
    actual_port = if port == 0, do: listener_port(server), else: port
    {actual_port, :bandit}
  end

  defp listener_port(server) do
    {:ok, {_, port}} = ThousandIsland.listener_info(server)
    port
  end

  defp wait_until_accepting(port) do
    Enum.reduce_while(1..50, nil, fn _, _ ->
      case :gen_tcp.connect(~c"127.0.0.1", port, [], 100) do
        {:ok, socket} ->
          :gen_tcp.close(socket)
          {:halt, :ok}

        {:error, _} ->
          Process.sleep(100)
          {:cont, nil}
      end
    end)
  end
end
