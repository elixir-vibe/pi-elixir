defmodule Pi.LLM.Broker do
  @moduledoc "Multiplexes BEAM-initiated LLM requests over the active pi transport."

  use GenServer

  alias Pi.LLM.Stream, as: LLMStream
  alias Pi.Protocol.LLMCancel
  alias Pi.Protocol.Response
  alias Pi.Transport.Stdio

  @timeout 60_000

  def start_link(opts \\ []), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  def install do
    case Process.whereis(__MODULE__) do
      nil -> start_link([])
      _pid -> :ok
    end
  end

  def complete(messages, opts \\ []) do
    request(
      :llm_complete,
      %{messages: messages, opts: Map.new(opts)},
      Keyword.get(opts, :timeout, @timeout)
    )
  end

  def request(op, payload, timeout \\ @timeout) when is_atom(op) and is_map(payload) do
    install()
    GenServer.call(__MODULE__, {:request, op, payload, timeout}, timeout + 1_000)
  end

  def stream(messages, opts \\ []) do
    request_stream(:llm_stream, %{messages: messages, opts: Map.new(opts)}, opts)
  end

  def deliver(id, result) when is_binary(id) do
    install()
    GenServer.cast(__MODULE__, {:deliver, id, result})
  end

  @impl true
  def init(_opts), do: {:ok, %{next_id: 0, pending: %{}}}

  @impl true
  def handle_call({:request, op, payload, timeout}, from, state) do
    id = request_id(state.next_id + 1)
    timer = Process.send_after(self(), {:timeout, id}, timeout)
    Stdio.emit_request(id, op, payload)

    pending = Map.put(state.pending, id, %{from: from, timer: timer})
    {:noreply, %{state | next_id: state.next_id + 1, pending: pending}}
  end

  @impl true
  def handle_cast({:deliver, id, result}, state) do
    {:noreply, reply(state, id, Response.to_result(result))}
  end

  @impl true
  def handle_info({:timeout, id}, state) do
    {:noreply, reply(state, id, {:error, "Pi LLM request timed out"})}
  end

  defp reply(state, id, result) do
    case Map.pop(state.pending, id) do
      {nil, _pending} ->
        state

      {%{from: from, timer: timer}, pending} ->
        Process.cancel_timer(timer)
        GenServer.reply(from, result)
        %{state | pending: pending}
    end
  end

  defp request_stream(op, payload, opts) do
    install()
    id = request_id(System.unique_integer([:positive]))
    Stdio.emit_request(id, op, payload)

    stream =
      Elixir.Stream.resource(
        fn -> id end,
        fn stream_id ->
          receive do
            {:pi_llm_chunk, ^stream_id, delta} -> {[delta], stream_id}
            {:pi_llm_done, ^stream_id, result} -> {[result], :done}
            {:pi_llm_error, ^stream_id, error} -> raise RuntimeError, message: inspect(error)
          after
            Keyword.get(opts, :timeout, @timeout) ->
              Stdio.emit(%LLMCancel{type: :llm_cancel, id: stream_id, reason: "timeout"})
              {:halt, stream_id}
          end
        end,
        fn
          :done -> :ok
          stream_id -> Stdio.emit(%LLMCancel{type: :llm_cancel, id: stream_id, reason: "closed"})
        end
      )

    %LLMStream{id: id, stream: stream}
  end

  defp request_id(next_id), do: "llm_#{System.unique_integer([:positive])}_#{next_id}"
end
