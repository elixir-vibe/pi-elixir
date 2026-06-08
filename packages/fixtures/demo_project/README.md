# pi-elixir demo project

This tiny Mix project is both a playground and an integration-test fixture for pi-elixir.

It demonstrates:

- path dependency on `pi_bridge`
- embedded stdio startup
- executable skill discovery from `priv/skills`
- plugin discovery from `priv/pi_plugins`
- BEAM-initiated `Pi.LLM` requests through the extension

Run manually:

```sh
mix deps.get
mix run --no-halt -e 'Pi.Transport.Stdio.start()'
```
