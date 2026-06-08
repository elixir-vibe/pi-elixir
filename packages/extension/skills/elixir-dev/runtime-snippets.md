# Runtime Snippets

## Module and docs discovery

```elixir
Code.ensure_loaded?(MyApp.Context)
MyApp.Context.module_info(:exports)
Code.fetch_docs(MyApp.Context)
Code.fetch_docs(Ecto.Changeset)
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
