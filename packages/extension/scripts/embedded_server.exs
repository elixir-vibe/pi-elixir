# Embedded MCP server for pi-elixir.
# Runs inside the project's Mix context via `mix run --no-halt <this_file>`.

beam_lib = Path.expand("../../bridge/lib", __DIR__)

for file <- [
      "pi/project.ex",
      "pi/log_capture.ex",
      "pi/eval.ex",
      "pi/integration.ex",
      "pi/integrations/phoenix.ex",
      "pi/integrations/ecto.ex",
      "pi/integrations/oban.ex",
      "pi/integrations/ex_unit.ex",
      "pi/integrations.ex",
      "pi/plugin.ex",
      "pi/protocol/api_function.ex",
      "pi/protocol/api_module.ex",
      "pi/protocol/api_inventory.ex",
      "pi/protocol/endpoint.ex",
      "pi/protocol/skill_info.ex",
      "pi/protocol/plugin_info.ex",
      "pi/protocol/bridge_info.ex",
      "pi/protocol/ready.ex",
      "pi/protocol/call.ex",
      "pi/protocol/result.ex",
      "pi/protocol/request.ex",
      "pi/protocol/response.ex",
      "pi/protocol/llm_message.ex",
      "pi/protocol/llm_chunk.ex",
      "pi/protocol/llm_done.ex",
      "pi/protocol/llm_error.ex",
      "pi/protocol/llm_cancel.ex",
      "pi/protocol/ui_event.ex",
      "pi/plugin/api.ex",
      "pi/plugin/event.ex",
      "pi/plugin/ui.ex",
      "pi/plugin/manager.ex",
      "pi/llm/stream.ex",
      "pi/llm/broker.ex",
      "pi/llm.ex",
      "pi/agent/session.ex",
      "pi/agent/result.ex",
      "pi/agent/step.ex",
      "pi/agent/registry.ex",
      "pi/agent.ex",
      "pi/req_llm/provider.ex",
      "pi/req_llm.ex",
      "pi/skill/executable.ex",
      "pi/skill/script.ex",
      "pi/skill/loader.ex",
      "pi/mcp/tools.ex",
      "pi/mcp/jsonrpc.ex",
      "pi/mcp/router.ex",
      "pi/mcp/server.ex",
      "pi/bridge/info.ex",
      "pi/transport/stdio.ex",
      "pi.ex"
    ] do
  Code.require_file(Path.join(beam_lib, file))
end

Pi.MCP.Server.start!(System.argv())
