# Runtime Snippets

## Module and docs discovery

Prefer docs from the loaded BEAM before web search:

```elixir
Code.ensure_loaded?(MyApp.Context)
MyApp.Context.module_info(:exports)
exports(MyApp.Context)
h(Ecto.Changeset.cast/4)
Code.fetch_docs(MyApp.Context)
Code.fetch_docs(Ecto.Changeset)
```

Structured function docs helper:

```elixir
doc = fn module, name, arity ->
  with {:docs_v1, _, _, _, _moduledoc, _meta, docs} <- Code.fetch_docs(module),
       {{kind, ^name, ^arity}, _anno, signatures, doc, metadata} <-
         Enum.find(docs, fn
           {{kind, ^name, ^arity}, _, _, _, _} when kind in [:function, :macro] -> true
           _ -> false
         end) do
    %{
      kind: kind,
      signatures: signatures,
      doc: case doc do
        %{"en" => text} -> text
        :hidden -> :hidden
        :none -> nil
      end,
      metadata: metadata
    }
  end
end

doc.(Ecto.Changeset, :cast, 4)
```

## Source locations

```elixir
:code.which(MyApp.Context)
MyApp.Context.module_info(:compile)
```

## OTP/process state

```elixir
Supervisor.which_children(MyApp.Supervisor)
:sys.get_state(MyApp.Worker)
Process.whereis(MyApp.Repo) |> Process.info([:memory, :message_queue_len, :current_function])
Process.list() |> Enum.map(&Process.info(&1, [:memory, :reductions])) |> Enum.take(10)
```

## Phoenix

```elixir
MyAppWeb.Router.__routes__()
Application.get_env(:my_app, MyAppWeb.Endpoint)
Phoenix.PubSub.node_name(MyApp.PubSub)
```

## Ecto

```elixir
MyApp.Schema.__schema__(:fields)
MyApp.Schema.__schema__(:associations)
MyApp.Schema.__schema__(:type, :field)
MyApp.Repo.all(Ecto.Query.from x in MyApp.Schema, limit: 5)
```

## Profiling and performance

```elixir
:timer.tc(fn -> MyApp.slow_call() end)
:erlang.statistics(:reductions)
```

For heavier profiling, use project-appropriate tools (`:fprof`, `:eprof`, `benchee`, telemetry) from eval or Mix.
