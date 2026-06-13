defmodule Pi.Skill.LoaderTest do
  use ExUnit.Case, async: false

  alias Pi.Skill.Loader

  test "discovers skills shipped in dependency priv directories" do
    base = Path.join(System.tmp_dir!(), "pi-skill-loader-#{System.unique_integer([:positive])}")
    app = :pi_skill_loader_fixture
    root = Path.join(base, "#{app}-0.1.0")
    ebin = Path.join(root, "ebin")
    skills_dir = Path.join(root, "priv/skills/fixture")

    File.mkdir_p!(ebin)
    File.mkdir_p!(skills_dir)

    File.write!(
      Path.join(ebin, "#{app}.app"),
      ~s({application, #{app}, [{vsn, "0.1.0"}, {modules, []}, {applications, [kernel, stdlib]}]}.)
    )

    File.write!(
      Path.join(skills_dir, "skill.exs"),
      ~S'''
      defmodule PiSkillLoaderFixture.Skill do
        use Pi.Skill.Script

        skill do
          name "fixture-skill"
          description "Fixture dependency skill"
        end

        @moduledoc "Dependency skill markdown"
      end
      '''
    )

    ebin_charlist = String.to_charlist(ebin)

    try do
      true = :code.add_patha(ebin_charlist)
      {:ok, _started} = Application.ensure_all_started(app)

      assert Enum.any?(Loader.discover(), fn skill ->
               skill.name == "fixture-skill" and skill.markdown == "Dependency skill markdown"
             end)
    after
      Application.unload(app)
      :code.del_path(ebin_charlist)
      File.rm_rf!(base)
    end
  end
end
