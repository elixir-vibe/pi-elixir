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

## Dev reload helpers

```elixir
Dev.status()
Dev.compile()
Dev.reload(prefixes: ["Elixir.MyApp"])
Dev.restart() # request /elixir:restart after eval returns
Dev.refresh() # request /elixir:refresh after eval returns
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

## pi session analytics with QuackDB/Ecto

Eval preloads short aliases for token-efficient analytical queries:

```elixir
# available by default in eval
# import Ecto.Query
# use QuackDB.Ecto
# alias Pi.Self, as: Self
# alias Pi.Quack, as: Q
# require Q
# alias Pi.Quack.Event, as: E
# alias Pi.Quack.SessionFile, as: SF
```

Use `Self` for bridge self-introspection and context recall:

```elixir
Self.status()
Self.quack()
Self.bindings()
Self.sessions()
Self.context("why did the last sync crash?", limit: 5)
```

Use the QuackDB mirror as a real analytical DB, not only slash commands:

```elixir
from(e in E,
  group_by: e.tool_name,
  order_by: [desc: count(e.id)],
  select: %{tool: e.tool_name, n: count(e.id)}
)
|> Q.table()
```

FTS and JSON helpers compose with QuackDB's Ecto DSL:

```elixir
q = "function_clause"

from(e in Q.errors(),
  where: Q.matches(e.id, ^q),
  order_by: [desc: Q.score(e.id, ^q)],
  limit: 20,
  select: %{
    s: Q.score(e.id, ^q),
    tool: e.tool_name,
    content: Q.json_text(e.payload_json, "$.content")
  }
)
|> Q.table()
```

Run raw DuckDB SQL only when the Ecto DSL is awkward:

```elixir
Q.sql!("SELECT event_type, count(*) n FROM pi_events GROUP BY 1 ORDER BY 2 DESC")
```

## Profiling and performance

```elixir
:timer.tc(fn -> MyApp.slow_call() end)
:erlang.statistics(:reductions)
```

For heavier profiling, use project-appropriate tools (`:fprof`, `:eprof`, `benchee`, telemetry) from eval or Mix.
