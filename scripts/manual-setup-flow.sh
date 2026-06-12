#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
RUN_ID=${RUN_ID:-$(date +%Y%m%d-%H%M%S)}
BASE=${BASE:-/tmp/pi-elixir-setup-flow-$RUN_ID}
SESSION_PREFIX=${SESSION_PREFIX:-pi-elixir-setup}
PI=${PI:-pi}
FRESH_HOME="$BASE/home"
LAST_PANE=""

mkdir -p "$BASE" "$FRESH_HOME"

log() {
  printf '\n== %s ==\n' "$*"
}

run_tmux() {
  local name=$1
  local cwd=$2
  local command=$3
  local session="$SESSION_PREFIX-$name"
  local pane="$BASE/$name.pane.txt"
  local cast="$BASE/$name.cast"
  local script="$BASE/$name.command.sh"
  printf '#!/usr/bin/env bash\nset -euo pipefail\nexport PATH=%q\ncd %q\n%s\n' "$PATH" "$cwd" "$command" > "$script"
  chmod +x "$script"

  tmux kill-session -t "$session" 2>/dev/null || true
  tmux new-session -d -s "$session" "asciinema rec -q -c '$script' '$cast'; printf '\n[DONE] exit=\$?\n'; sleep 3"

  for _ in $(seq 1 90); do
    tmux capture-pane -t "$session" -p -S -160 > "$pane" 2>/dev/null || true
    if rg -q '\[DONE\]|pi-elixir doctor|Extension issues|Failed to load|No Mix project|pi_bridge|Elixir|Mix cwd|dependency|connection|timed out|error' "$pane"; then
      tail -120 "$pane"
    fi
    if rg -q '\[DONE\]' "$pane"; then break; fi
    sleep 2
  done

  tmux capture-pane -t "$session" -p -S -220 > "$pane" 2>/dev/null || true
  LAST_PANE="$pane"
}

make_minimal_mix_project() {
  local dir=$1
  mkdir -p "$dir/lib"
  cat > "$dir/mix.exs" <<'MIX'
defmodule SetupFlow.MixProject do
  use Mix.Project

  def project do
    [app: :setup_flow, version: "0.1.0", elixir: "~> 1.20", deps: deps()]
  end

  def application, do: [extra_applications: [:logger]]

  defp deps do
    []
  end
end
MIX
  cat > "$dir/lib/setup_flow.ex" <<'ELIXIR'
defmodule SetupFlow do
  def hello, do: :world
end
ELIXIR
}

make_bridge_mix_project() {
  local dir=$1
  mkdir -p "$dir/lib"
  cat > "$dir/mix.exs" <<MIX
defmodule SetupFlow.MixProject do
  use Mix.Project

  def project do
    [app: :setup_flow, version: "0.1.0", elixir: "~> 1.20", deps: deps()]
  end

  def application, do: [extra_applications: [:logger]]
  defp deps, do: [{:pi_bridge, path: "$ROOT/packages/bridge", only: :dev}]
end
MIX
  cat > "$dir/lib/setup_flow.ex" <<'ELIXIR'
defmodule SetupFlow do
  def hello, do: :world
end
ELIXIR
}

install_project_package() {
  local dir=$1
  log "project-local pi install in $dir"
  (cd "$dir" && HOME="$FRESH_HOME" "$PI" install -l "$ROOT" --approve)
}

run_command_interactive() {
  local name=$1
  local cwd=$2
  local pi_command=$3
  local approve=${4:-0}
  local session="$SESSION_PREFIX-$name"
  local pane="$BASE/$name.pane.txt"
  local cast="$BASE/$name.cast"

  tmux kill-session -t "$session" 2>/dev/null || true
  local script="$BASE/$name.command.sh"
  printf '#!/usr/bin/env bash\nset -euo pipefail\nexport PATH=%q\ncd %q\nHOME=%q PI_OFFLINE=1 PI_CODING_AGENT_SESSION_DIR=%q %q --approve --offline\n' "$PATH" "$cwd" "$FRESH_HOME" "$BASE/sessions-$name" "$PI" > "$script"
  chmod +x "$script"

  tmux new-session -d -s "$session" "asciinema rec -q -c '$script' '$cast'; printf '\n[DONE] exit=\$?\n'; sleep 3"
  sleep 4
  if tmux has-session -t "$session" 2>/dev/null; then
    tmux send-keys -t "$session" "$pi_command" C-m
    sleep 2
    if [[ "$approve" == "1" ]]; then
      tmux send-keys -t "$session" 'y' C-m
      sleep 3
    fi
    tmux send-keys -t "$session" '/quit' C-m
  fi

  for _ in $(seq 1 30); do
    tmux capture-pane -t "$session" -p -S -220 > "$pane" 2>/dev/null || true
    if rg -q '\[DONE\]' "$pane"; then break; fi
    sleep 1
  done

  tmux capture-pane -t "$session" -p -S -260 > "$pane" 2>/dev/null || true
  tail -180 "$pane"
  LAST_PANE="$pane"
}

run_doctor_interactive() {
  run_command_interactive "$1" "$2" '/elixir:doctor'
}

scan_known_issues() {
  local label=$1
  local file=$2
  local pattern=${3:-'Extension issues|Failed to load extension|Tool .* conflicts|Cannot find module|version mismatch|Embedded BEAM tool call timed out'}
  log "scan $label"
  if rg "$pattern" "$file"; then
    return 1
  fi
  echo "clean"
}

log "artifacts: $BASE"

OUTSIDE="$BASE/outside"
MISSING="$BASE/missing-dep"
WRONG="$BASE/wrong-elixir"
INSTALL="$BASE/install-command"
READY="$ROOT/packages/fixtures/demo_project"
mkdir -p "$OUTSIDE" "$WRONG/bin" "$INSTALL/bin"
make_minimal_mix_project "$MISSING"
make_minimal_mix_project "$INSTALL"
make_bridge_mix_project "$WRONG"
cat > "$INSTALL/bin/mix" <<'FAKE_MIX_OK'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  echo 'Mix 1.20.1 (compiled with Erlang/OTP 29)'
  exit 0
fi
if [[ "${1:-}" == "deps.get" ]]; then
  exit 0
fi
echo "unexpected mix args: $*" >&2
exit 1
FAKE_MIX_OK
chmod +x "$INSTALL/bin/mix"
cat > "$WRONG/bin/elixir" <<'FAKE_ELIXIR'
#!/usr/bin/env bash
echo 'Erlang/OTP 28 [erts-16.0]'
echo 'Elixir 1.19.5 (compiled with Erlang/OTP 28)'
FAKE_ELIXIR
cat > "$WRONG/bin/mix" <<'FAKE_MIX'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  echo 'Erlang/OTP 28 [erts-16.0]'
  echo 'Mix 1.19.5 (compiled with Erlang/OTP 28)'
  exit 0
fi
cat >&2 <<'ERR'
** (Mix) You're trying to run :pi_bridge on Elixir v1.19.5 but it has declared in its mix.exs file it supports only Elixir ~> 1.20
ERR
exit 1
FAKE_MIX
chmod +x "$WRONG/bin/elixir" "$WRONG/bin/mix"

install_project_package "$OUTSIDE"
install_project_package "$MISSING"
install_project_package "$WRONG"
install_project_package "$INSTALL"

log "doctor outside Mix project"
run_doctor_interactive outside "$OUTSIDE"
scan_known_issues outside "$LAST_PANE" || true

log "doctor Mix project missing pi_bridge dependency"
run_doctor_interactive missing "$MISSING"
scan_known_issues missing "$LAST_PANE" || true

log "explicit install command"
ORIGINAL_PATH="$PATH"
PATH="$INSTALL/bin:$PATH" run_command_interactive install-command "$INSTALL" '/elixir:install'
PATH="$ORIGINAL_PATH"
if rg -q 'pi_bridge' "$INSTALL/mix.exs"; then
  echo "install command added pi_bridge dependency"
else
  echo "install command did not add pi_bridge dependency"
fi
scan_known_issues install-command "$LAST_PANE" || true

log "doctor wrong Elixir version"
ORIGINAL_PATH="$PATH"
PATH="$WRONG/bin:$PATH" run_doctor_interactive wrong-version "$WRONG"
PATH="$ORIGINAL_PATH"
if rg -q "supports only Elixir ~> 1.20" "$LAST_PANE"; then
  echo "wrong version startup failure surfaced"
else
  echo "wrong version startup failure was not surfaced"
fi
scan_known_issues wrong-version "$LAST_PANE" || true

log "happy path print tools in fixture"
HAPPY_CMD="PI_OFFLINE=1 PI_CODING_AGENT_SESSION_DIR='$BASE/sessions-happy' mise exec -- $PI --approve --no-extensions --no-skills --no-context-files --extension '$ROOT/packages/extension/src/index.ts' --tools elixir_eval,elixir_ast_search --print 'Use elixir_eval to evaluate System.version() and elixir_ast_search to find def hello do _ end in lib. Return concise results.'"
run_tmux happy "$READY" "$HAPPY_CMD"
scan_known_issues happy "$LAST_PANE"

log "duplicate install conflict scenario (expected failure until user removes npm:pi-elixir or dogfoods)"
DUP="$BASE/duplicate"
mkdir -p "$DUP"
(cd "$DUP" && "$PI" install -l "$ROOT" --approve)
DUP_CMD="PI_OFFLINE=1 $PI --approve --offline --print 'say ok'"
run_tmux duplicate "$DUP" "$DUP_CMD"
if rg -q 'Tool .* conflicts' "$LAST_PANE"; then
  echo "expected duplicate conflict reproduced"
else
  echo "duplicate conflict not reproduced"
fi

log "done"
find "$BASE" -maxdepth 2 -type f | sort
