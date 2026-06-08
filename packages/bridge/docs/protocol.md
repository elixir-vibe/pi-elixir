# pi_bridge protocol examples

The bridge keeps protocol data as JSONCodec structs internally. These examples show the JSON shape at process/HTTP boundaries.

## Stdio ready

```json
{
  "type": "ready",
  "info": {
    "project": "pi_bridge",
    "transport": "stdio",
    "integrations": ["ex_unit"],
    "skills": [],
    "plugins": [],
    "endpoints": [],
    "apis": {
      "runtime": [
        {
          "name": "llm",
          "module": "Elixir.Pi.LLM",
          "functions": [{ "name": "complete", "arity": 1 }]
        }
      ],
      "extensions": []
    }
  }
}
```

## Stdio tool call/result

```json
{ "type": "call", "id": 1, "name": "project_eval", "arguments": { "code": "1 + 1" } }
```

```json
{ "type": "result", "id": 1, "text": "2", "isError": false }
```

## BEAM-initiated LLM completion

```json
{
  "type": "request",
  "id": "llm_123_1",
  "op": "llm_complete",
  "payload": {
    "messages": [{ "role": "user", "content": "hello" }],
    "opts": {}
  }
}
```

```json
{ "type": "response", "id": "llm_123_1", "ok": true, "result": "hello from pi" }
```

## BEAM-initiated LLM streaming

```json
{
  "type": "request",
  "id": "llm_456_2",
  "op": "llm_stream",
  "payload": {
    "messages": [{ "role": "user", "content": "stream" }],
    "opts": {}
  }
}
```

```json
{ "type": "llm_chunk", "id": "llm_456_2", "delta": "first " }
{ "type": "llm_chunk", "id": "llm_456_2", "delta": "second" }
{ "type": "llm_done", "id": "llm_456_2", "result": "" }
```

Cancellation from BEAM to pi:

```json
{ "type": "llm_cancel", "id": "llm_456_2", "reason": "closed" }
```

## UI status event

```json
{ "type": "ui", "op": "status", "key": "ecto", "text": "ecto 1/1" }
```

## BEAM-to-pi extension event bus

```json
{ "type": "event", "name": "pi-elixir:demo", "data": { "events": 1 } }
```

## Plugin command and tool hooks

Plugin commands are called by the TypeScript extension after it registers `/elixir:<name>` commands from the ready inventory:

```json
{ "type": "call", "id": 2, "name": "pi_plugin_command", "arguments": { "name": "demo_plugin_status", "args": "smoke" } }
```

Tool hooks use strict hook payload shapes before dispatching to plugin callbacks. `pi_plugin_tool_call` responses patch tool input only; result hook responses may patch result `content` or `isError`.

```json
{ "type": "call", "id": 3, "name": "pi_plugin_tool_call", "arguments": { "toolName": "bash", "toolCallId": "tool_1", "input": { "command": "pwd" } } }
```

```json
{ "type": "result", "id": 3, "text": "{\"block\":\"blocked by plugin\"}", "isError": false }
```

## MCP JSON-RPC

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": { "name": "project_eval", "arguments": { "code": "1 + 1" } }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "content": [{ "type": "text", "text": "2" }] }
}
```
