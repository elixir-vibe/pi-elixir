const FALSE_VALUES = new Set(['0', 'false', 'off', 'no'])

function envEnabled(name: string, defaultValue = true): boolean {
  const value = process.env[name]
  if (value === undefined) return defaultValue
  return !FALSE_VALUES.has(value.trim().toLowerCase())
}

export const flags = {
  statefulEval: () => envEnabled('PI_ELIXIR_STATEFUL_EVAL'),
  evalSidecar: () => envEnabled('PI_ELIXIR_EVAL_SIDECAR'),
  llm: () => envEnabled('PI_ELIXIR_LLM'),
  sessions: () => envEnabled('PI_ELIXIR_SESSIONS'),
  plugins: () => envEnabled('PI_ELIXIR_PLUGINS'),
  skills: () => envEnabled('PI_ELIXIR_SKILLS'),
  compactEvalPreview: () => envEnabled('PI_ELIXIR_COMPACT_EVAL_PREVIEW', false)
}
