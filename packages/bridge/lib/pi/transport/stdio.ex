defmodule Pi.Transport.Stdio do
  @moduledoc "Line-delimited JSON transport for extension-owned BEAM sessions."

  require Logger
  require Pi.Features

  alias Pi.Bridge.Info
  alias Pi.LLM.Broker
  alias Pi.MCP.Tools
  alias Pi.Plugin.Event
  alias Pi.Plugin.Manager
  alias Pi.Protocol.Call
  alias Pi.Protocol.LLM.Chunk
  alias Pi.Protocol.LLM.Done
  alias Pi.Protocol.LLM.Error
  alias Pi.Protocol.PluginHook
  alias Pi.Protocol.PluginHookResponse
  alias Pi.Protocol.Ready
  alias Pi.Protocol.Request
  alias Pi.Protocol.Response
  alias Pi.Protocol.Result
  alias Pi.Skill.Loader

  def emit_request(id, op, payload) when is_binary(id) and is_atom(op) and is_map(payload) do
    emit(%Request{type: :request, id: id, op: op, payload: payload})
  end

  def emit(payload) when is_map(payload) do
    case :persistent_term.get({__MODULE__, :pid}, nil) do
      nil -> :ok
      pid -> send(pid, {:pi_transport_emit, payload |> to_payload() |> normalize()})
    end
  end

  @doc false
  def __test_payload__(payload), do: payload |> to_payload() |> normalize()

  @doc false
  def __test_dispatch__(name, args), do: dispatch(name, args)

  @doc false
  def __test_handle_line__(line), do: handle_line(line)

  @doc false
  def __test_safe_call__(name, fun) when is_binary(name) and is_function(fun, 0) do
    safe_call("pi stdio test call failed: #{name}", fun)
  end

  def start do
    :persistent_term.put({__MODULE__, :pid}, self())
    Event.install()
    if Pi.Features.plugins?(), do: Manager.install()
    Broker.install()
    Pi.Eval.Supervisor.install()
    ready()

    parent = self()

    spawn_link(fn ->
      IO.stream(:stdio, :line)
      |> Enum.each(&send(parent, {:stdin, &1}))
    end)

    loop()
  end

  defp loop do
    receive do
      {:stdin, line} ->
        handle_line(line)
        loop()

      {:pi_transport_emit, payload} ->
        write(payload)
        loop()
    end
  end

  defp handle_line(line) do
    case decode_line(line) do
      {:ok, payload} -> handle_payload(payload)
      :ignore -> :ok
    end
  end

  defp decode_line(line) do
    case Jason.decode(line) do
      {:ok, %{"type" => "call"} = payload} -> decode_payload(Call, payload)
      {:ok, %{"type" => "response"} = payload} -> decode_payload(Response, payload)
      {:ok, %{"type" => "llm_chunk"} = payload} -> decode_payload(Chunk, payload)
      {:ok, %{"type" => "llm_done"} = payload} -> decode_payload(Done, payload)
      {:ok, %{"type" => "llm_error"} = payload} -> decode_payload(Error, payload)
      _ -> :ignore
    end
  end

  defp decode_payload(module, payload) do
    case module.from_map(payload) do
      {:ok, payload} -> {:ok, payload}
      {:error, _reason} -> :ignore
    end
  end

  defp handle_payload(%Call{} = call),
    do: spawn(fn -> safe_respond(call.id, call.name, safe_dispatch(call)) end)

  defp handle_payload(%Response{} = response), do: Broker.deliver(response.id, response)
  defp handle_payload(%Chunk{} = chunk), do: Broker.deliver_stream(chunk.id, :chunk, chunk.delta)
  defp handle_payload(%Done{} = done), do: Broker.deliver_stream(done.id, :done, done.result)
  defp handle_payload(%Error{} = error), do: Broker.deliver_stream(error.id, :error, error.error)

  defp safe_dispatch(%Call{} = call) do
    safe_call("pi stdio tool call failed: #{call.name}", fn ->
      dispatch(call.name, call.arguments)
    end)
  end

  defp safe_call(log_prefix, fun) when is_binary(log_prefix) and is_function(fun, 0) do
    fun.()
  catch
    kind, reason ->
      message = Exception.format(kind, reason, __STACKTRACE__)
      Logger.error("#{log_prefix}\n#{message}")
      {:error, message}
  end

  defp dispatch("pi_skills_list", _args) do
    if Pi.Features.skills?(),
      do: {:ok, encode_structs(Loader.serializable())},
      else: {:ok, "[]"}
  end

  defp dispatch("pi_event", args) do
    Event.push(args)
    if Pi.Features.plugins?(), do: Manager.dispatch_event(args)
    {:ok, "ok"}
  end

  defp dispatch("pi_plugin_command", %{"name" => name, "args" => args}) when is_binary(name) do
    Pi.Features.gate :plugins do
      name
      |> run_plugin_command(to_string(args || ""))
      |> encode_reply()
    end
    |> encode_plugin_command_reply()
  end

  defp dispatch("pi_plugin_tool_call", args) do
    Pi.Features.gate :plugins do
      case PluginHook.from_wire(args) do
        {:ok, hook} ->
          hook
          |> plugin_hook_payload()
          |> Manager.tool_call(hook.context)
          |> encode_hook_reply()

        {:error, _reason} ->
          encode_hook_reply({:error, "Invalid plugin hook payload"})
      end
    end
    |> encode_plugin_hook_reply()
  end

  defp dispatch("pi_plugin_tool_result", args) do
    Pi.Features.gate :plugins do
      case PluginHook.from_wire(args) do
        {:ok, hook} ->
          hook
          |> plugin_hook_payload()
          |> Manager.tool_result(hook.context)
          |> encode_hook_reply()

        {:error, _reason} ->
          encode_hook_reply({:error, "Invalid plugin hook payload"})
      end
    end
    |> encode_plugin_hook_reply()
  end

  defp dispatch("pi_bridge_info", _args) do
    {:ok, Jason.encode!(Info.snapshot(:stdio))}
  end

  defp dispatch("pi_bridge_apis", _args) do
    {:ok, encode_structs(Info.apis())}
  end

  defp dispatch("pi_apis", _args) do
    {:ok, encode_structs(Info.runtime_apis())}
  end

  defp dispatch(name, args), do: Tools.dispatch(name, args)

  defp run_plugin_command("quack" <> _rest = name, args) do
    case Manager.run_command(name, args) do
      {:error, "Unknown plugin command: " <> _command} ->
        _ = Manager.load(Pi.Mirror.QuackDB)
        Manager.run_command(name, args)

      reply ->
        reply
    end
  end

  defp run_plugin_command(name, args), do: Manager.run_command(name, args)

  defp plugin_hook_payload(%PluginHook{} = hook) do
    %{
      "toolName" => hook.tool_name,
      "toolCallId" => hook.tool_call_id,
      "input" => hook.input,
      "content" => hook.content,
      "isError" => hook.is_error
    }
  end

  defp encode_plugin_command_reply({:error, message}), do: encode_reply({:error, message})
  defp encode_plugin_command_reply(reply), do: reply

  defp encode_plugin_hook_reply({:error, message}), do: encode_hook_reply({:error, message})
  defp encode_plugin_hook_reply(reply), do: reply

  defp encode_hook_reply({:ok, value}) when is_map(value) do
    encode_reply(PluginHookResponse.ok(value))
  end

  defp encode_hook_reply({:block, reason}), do: encode_reply(PluginHookResponse.block(reason))
  defp encode_hook_reply({:error, reason}), do: encode_reply(PluginHookResponse.error(reason))
  defp encode_hook_reply(:ok), do: encode_reply(PluginHookResponse.ok())
  defp encode_hook_reply(value), do: encode_reply(value)

  defp encode_reply(reply), do: {:ok, Jason.encode!(reply |> reply_payload() |> normalize())}

  defp reply_payload(%_module{} = value), do: to_payload(value)
  defp reply_payload({:ok, value}) when is_map(value), do: %{ok: value}
  defp reply_payload({:ok, value}) when is_binary(value), do: %{ok: value}
  defp reply_payload({:error, value}), do: %{error: value}
  defp reply_payload({:block, value}), do: %{block: value}
  defp reply_payload(:ok), do: %{ok: %{}}
  defp reply_payload(value) when is_binary(value), do: %{ok: value}
  defp reply_payload(value) when is_map(value), do: value

  defp safe_respond(id, name, reply) do
    respond(id, reply)
  catch
    kind, reason ->
      message = Exception.format(kind, reason, __STACKTRACE__)
      Logger.error("pi stdio tool response failed: #{name}\n#{message}")
      respond(id, {:error, message})
  end

  defp respond(id, {:ok, text}) do
    write(%Result{type: :result, id: id, text: text, is_error: false})
  end

  defp respond(id, {:error, message}) do
    write(%Result{type: :result, id: id, text: message, is_error: true})
  end

  defp ready, do: write(%Ready{type: :ready, info: Info.snapshot(:stdio)})

  defp encode_structs(values) do
    values
    |> Enum.map(&to_payload/1)
    |> Jason.encode!()
  end

  defp write(payload) do
    IO.write([Jason.encode!(payload |> to_payload() |> normalize()), ?\n])
  end

  defp to_payload(%Result{} = result) do
    %{
      type: result.type,
      id: result.id,
      text: result.text,
      isError: result.is_error
    }
  end

  defp to_payload(%PluginHookResponse{} = response) do
    response
    |> JSONCodec.dump()
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  defp to_payload(%_module{} = struct), do: JSONCodec.dump(struct)

  defp to_payload(map) when is_map(map), do: map

  defp normalize(map) when is_map(map) do
    Map.new(map, fn {key, value} -> {key, normalize_value(value)} end)
  end

  defp normalize_value(%_module{} = value), do: value |> to_payload() |> normalize()
  defp normalize_value(value) when is_boolean(value), do: value
  defp normalize_value(nil), do: nil
  defp normalize_value(value) when is_atom(value), do: Atom.to_string(value)
  defp normalize_value(value) when is_map(value), do: normalize(value)
  defp normalize_value(value) when is_list(value), do: Enum.map(value, &normalize_value/1)
  defp normalize_value(value), do: value
end
