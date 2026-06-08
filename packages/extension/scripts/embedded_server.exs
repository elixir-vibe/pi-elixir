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
      "pi/plugin/api.ex",
      "pi/plugin/event.ex",
      "pi/plugin/ui.ex",
      "pi/plugin/manager.ex",
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
