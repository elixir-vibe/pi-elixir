---
name: elixir-webdev
description: Phoenix/LiveView web development in existing projects: UI building, frontend assets, styling, browser-console feedback, PhoenixReplay debugging, and interactive verification. Use elixir-dev for general Elixir work and elixir-new-project for bootstrapping new projects.
---

# Elixir Web Development

Use this skill for Phoenix/LiveView frontend work in existing projects. Keep eval as the control plane: do not add or expect extra model-facing tools for web development.

Use `elixir_eval` to verify UI/runtime claims before final answers: browser console logs, replay recordings, render output, icon names, Tailwind extraction, and SFC compilation.

Read the focused guidance files as needed:

- `feedback-loops.md` — browser console logs, replay records, render-without-browser checks.
- `replay-debugging.md` — PhoenixReplay timeline debugging and re-render verification.
- `ui-verification.md` — icons, Tailwind candidates, rendered HTML, Vue SFC checks.
- `volt.md` — Volt build/lint/format/Tailwind and HMR feedback.

For general BEAM/source work, use `elixir-dev`. For creating or bootstrapping Phoenix projects, use `elixir-new-project`; the default Phoenix setup should be Phoenix + Igniter + VibeKit, then Igniter-installed Volt and published PhoenixReplay/PhoenixIconify. Do not recommend `phoenix_vapor` by default yet.
