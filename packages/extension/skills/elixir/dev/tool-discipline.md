# Tool Discipline

## Eval first for BEAM/runtime questions

`elixir_eval` runs inside the project VM with project modules, dependencies, application config, IEx helpers, and runtime state available.

Use Elixir/OTP stdlib directly for ordinary work:

```elixir
System.version()
exports(MyApp.Context)
h(Ecto.Changeset.cast/4)
i(%MyApp.Schema{})
Application.started_applications() |> Enum.map(&elem(&1, 0)) |> Enum.sort()
:erlang.memory()
Process.registered() |> Enum.sort()
File.ls!("lib")
Path.wildcard("lib/**/*.ex")
File.read!("mix.exs")
```

Use `Pi.*` shortcuts only when they provide bounded summaries or avoid repetitive introspection boilerplate:

```elixir
Pi.project()
Pi.logs(tail: 50)
Pi.clear_logs()
```

Reserve shell for tools with no BEAM equivalent: `git`, `mix`, `rg` for non-structural text search, package managers, and external CLIs.

## AST tools for Elixir code structure

Use `elixir_ast_search` for patterns like:

```elixir
IO.inspect(_)
%Step{id: "subject"}
def handle_call(_, _, _) do _ end
{:error, reason}
```

Use `elixir_ast_replace` for syntax-aware rewrites:

```elixir
pattern: 'dbg(expr)'
replacement: 'expr'

pattern: 'IO.inspect(expr, _)'
replacement: 'Logger.debug(inspect(expr))'
```

Use text search only when the question is textual, not syntactic.

## LSP for editor semantics

Use LSP for diagnostics, definitions, references, hover/type info, workspace/file symbols, and code actions.

Runtime tools know the loaded system; LSP knows editor/file semantics. Use both when useful.
