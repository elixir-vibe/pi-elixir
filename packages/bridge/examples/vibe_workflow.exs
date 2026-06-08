# Minimal Vibe-style workflow fixture for pi_bridge.
# Run inside a project with pi_bridge available: mix run examples/vibe_workflow.exs

Pi.ReqLLM.install()

{:ok, plan} = Pi.Agent.run("Plan a small refactor", name: :planner)
{:ok, review} = Pi.Agent.run("Review this plan: #{inspect(plan.result)}", name: :reviewer)

IO.inspect(%{plan: plan.result, review: review.result}, label: "vibe_workflow")
