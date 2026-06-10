defmodule Pi.WebTest do
  use ExUnit.Case, async: false

  alias Pi.Output
  alias Pi.Protocol.Tool.OutputPart
  alias Pi.Web
  alias Pi.Web.Result

  test "rejects non-http URLs" do
    assert {:error, :invalid_url} = Web.fetch("file:///etc/passwd")
  end

  test "fetches bounded HTML as text" do
    {:ok, url} =
      serve_once(
        "HTTP/1.1 200 OK\r\ncontent-type: text/html\r\n\r\n<html><head><title>Hello</title></head><body><h1>Hello</h1><p>world</p></body></html>"
      )

    assert {:ok, %Result{} = result} = Web.fetch(url, kind: :text)
    assert result.status == 200
    assert result.title == "Hello"
    assert result.text =~ "Hello"
    assert result.text =~ "world"
    refute result.truncated?
  end

  test "fetches and pretty-prints JSON" do
    {:ok, url} =
      serve_once(~s(HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n{"ok":true}))

    assert {:ok, %Result{format: :json, text: text}} = Web.fetch(url, format: :json)
    assert text =~ ~s("ok": true)
  end

  test "web results auto-render through output protocol" do
    result = %Result{
      url: "https://example.test",
      final_url: "https://example.test",
      status: 200,
      content_type: "text/plain",
      format: :text,
      title: "Example",
      text: "hello world",
      size_bytes: 11,
      total_chars: 11
    }

    assert %Output{parts: [%OutputPart{kind: :text, title: preview}]} =
             Output.Renderable.to_output(result, [])

    assert preview == "GET 200 Example"
  end

  defp serve_once(response) do
    {:ok, listen} =
      :gen_tcp.listen(0, [
        :binary,
        packet: :raw,
        active: false,
        reuseaddr: true,
        ip: {127, 0, 0, 1}
      ])

    {:ok, {{127, 0, 0, 1}, port}} = :inet.sockname(listen)
    parent = self()

    {:ok, _pid} =
      Task.start(fn ->
        {:ok, socket} = :gen_tcp.accept(listen)
        {:ok, _request} = :gen_tcp.recv(socket, 0, 2_000)
        :ok = :gen_tcp.send(socket, response)
        :gen_tcp.close(socket)
        :gen_tcp.close(listen)
        send(parent, :served)
      end)

    {:ok, "http://127.0.0.1:#{port}/"}
  end
end
