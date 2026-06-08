defmodule PiDemoProject.DemoSkill do
  @moduledoc "Demo executable skill for pi-elixir fixture tests."

  use Pi.Skill.Script

  skill do
    name "demo-skill"
    description "Demo skill loaded from a consuming Mix project fixture."
    alias_as __MODULE__
    examples ["Call PiDemoProject.hello/0"]
    markdown "Use this skill to demonstrate executable Elixir skill discovery."
  end
end
