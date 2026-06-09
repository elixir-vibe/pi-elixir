# Tool Discipline

## Eval first for BEAM/runtime and docs questions

`elixir_eval` runs inside the project VM with project modules, dependencies, application config, IEx helpers, docs chunks, and runtime state available.

For installed Elixir modules, look up docs through BEAM APIs before guessing or web-searching. Use `Code.fetch_docs/1` for structured docs and IEx helpers for quick interactive docs:

```elixir
Code.fetch_docs(Ecto.Changeset)
h(Ecto.Changeset.cast/4)
exports(MyApp.Context)
i(%MyApp.Schema{})
```

Use Elixir/OTP stdlib directly for ordinary runtime and file work:

```elixir
System.version()
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

## AST tools for Elixir code structure and refactoring

For Elixir source, use AST tools whenever the question is about code shape. Do not default to `rg` for callback implementations, function calls, structs, maps, tuples, pipelines, guards, macros, or refactor targets.

Use `elixir_ast_search` for patterns like:

```elixir
IO.inspect(_)
%Step{id: "subject"}
def handle_call(_, _, _) do _ end
{:error, reason}
```

Use `elixir_ast_replace` for syntax-aware rewrites and broad refactors:

```elixir
pattern: 'dbg(expr)'
replacement: 'expr'

pattern: 'IO.inspect(expr, _)'
replacement: 'Logger.debug(inspect(expr))'
```

Use text search only when the question is textual, not syntactic: comments, literal strings, config keys, docs text, or filenames. For code structure, AST search first; for code rewrites, AST replace first, then exact text edits only when AST replacement cannot express the change.

## LSP for editor semantics

Use LSP for diagnostics, definitions, references, hover/type info, workspace/file symbols, and code actions.

Runtime tools know the loaded system; LSP knows editor/file semantics. Use both when useful.
