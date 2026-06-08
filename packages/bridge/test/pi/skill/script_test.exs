defmodule Pi.Skill.ScriptTest do
  use ExUnit.Case, async: true

  defmodule DemoSkill do
    @moduledoc "Fallback markdown"
    use Pi.Skill.Script

    skill do
      name("demo-skill")
      description("Demo description")
      alias_as(__MODULE__)
      examples(["run demo"])
    end
  end

  test "builds metadata, markdown, and default API from the DSL" do
    assert DemoSkill.metadata() == %{
             name: "demo-skill",
             description: "Demo description",
             alias: :DemoSkill,
             examples: ["run demo"]
           }

    assert DemoSkill.markdown() == "Fallback markdown"

    assert [api] = DemoSkill.apis()
    assert %Pi.Plugin.API{name: :demo_skill, module: DemoSkill, alias: :DemoSkill} = api
    assert api.description == "Demo description"
  end
end
