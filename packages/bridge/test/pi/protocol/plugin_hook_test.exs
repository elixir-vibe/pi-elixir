defmodule Pi.Protocol.PluginHookTest do
  use ExUnit.Case, async: true

  alias Pi.Protocol.PluginHook

  test "rejects malformed hook payloads" do
    assert {:error, :invalid_plugin_hook} = PluginHook.from_wire(%{})
    assert {:error, :invalid_plugin_hook} = PluginHook.from_wire(%{"toolName" => "bash"})
  end

  test "normalizes valid hook payloads" do
    assert {:ok,
            %PluginHook{
              tool_name: "bash",
              tool_call_id: "tool-1",
              input: %{"command" => "pwd"},
              context: %{"sessionFile" => "session.jsonl"}
            }} =
             PluginHook.from_wire(%{
               "toolName" => "bash",
               "toolCallId" => "tool-1",
               "input" => %{"command" => "pwd"},
               "context" => %{"sessionFile" => "session.jsonl"}
             })
  end
end
