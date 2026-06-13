defmodule Pi.Skill.Loader do
  @moduledoc "Discovers trusted executable Elixir skills in the current Mix project."

  alias Pi.Plugin.API
  alias Pi.Protocol.API.Extension
  alias Pi.Protocol.SkillInfo
  alias Pi.Skill.Executable

  @spec load_file(String.t()) :: {:ok, [Executable.t()]} | {:error, term()}
  def load_file(path) when is_binary(path) do
    path = Path.expand(path)
    key = {__MODULE__, :file, path}
    mtime = File.stat!(path).mtime

    case :persistent_term.get(key, nil) do
      {^mtime, skills} ->
        {:ok, skills}

      _stale ->
        modules =
          path
          |> Code.compile_file()
          |> Enum.map(&elem(&1, 0))
          |> Enum.filter(&skill_module?/1)

        skills = Enum.map(modules, &executable(&1, path))
        :persistent_term.put(key, {mtime, skills})
        {:ok, skills}
    end
  rescue
    exception in [ArgumentError, Code.LoadError, CompileError, File.Error, SyntaxError] ->
      {:error, Exception.format(:error, exception, __STACKTRACE__)}
  end

  @spec discover(keyword()) :: [Executable.t()]
  def discover(opts \\ []) do
    opts
    |> Keyword.get(:paths, default_paths())
    |> Enum.flat_map(fn dir ->
      case load_dir(dir) do
        {:ok, skills} -> skills
        {:error, _reason} -> []
      end
    end)
    |> Enum.uniq_by(&{&1.name, &1.module})
  end

  @spec serializable(keyword()) :: [SkillInfo.t()]
  def serializable(opts \\ []) do
    opts
    |> discover()
    |> Enum.map(fn skill ->
      %SkillInfo{
        name: skill.name,
        path: skill.path,
        module: skill.module,
        metadata: atom_keys_to_strings(skill.metadata),
        markdown: skill.markdown,
        apis: Enum.map(skill.apis, &Extension.from_api/1)
      }
    end)
  end

  defp load_dir(dir) do
    dir
    |> files()
    |> Enum.reduce_while({:ok, []}, fn file, {:ok, acc} ->
      case load_file(file) do
        {:ok, skills} -> {:cont, {:ok, [skills | acc]}}
        {:error, reason} -> {:halt, {:error, {file, reason}}}
      end
    end)
    |> case do
      {:ok, skills} -> {:ok, skills |> Enum.reverse() |> List.flatten()}
      error -> error
    end
  end

  defp default_paths do
    [
      Path.join(File.cwd!(), "priv/skills"),
      Path.join(File.cwd!(), ".pi/skills"),
      Path.join(File.cwd!(), "skills")
    ] ++ dependency_skill_paths()
  end

  defp dependency_skill_paths do
    (loaded_app_skill_paths() ++ mix_dependency_skill_paths())
    |> Enum.uniq()
  end

  defp loaded_app_skill_paths do
    Application.loaded_applications()
    |> Enum.flat_map(fn {app, _description, _version} -> app_skill_path(app) end)
  end

  defp mix_dependency_skill_paths do
    if Code.ensure_loaded?(Mix.Dep) and Mix.Project.get() do
      Mix.Dep.cached()
      |> Enum.flat_map(fn dep ->
        [dep.opts[:build], dep.opts[:dest]]
        |> Enum.reject(&is_nil/1)
        |> Enum.map(&Path.join(&1, "priv/skills"))
      end)
    else
      []
    end
  rescue
    _exception in [Mix.Error, ArgumentError] -> []
  end

  defp app_skill_path(app) do
    case :code.priv_dir(app) do
      priv_dir when is_list(priv_dir) -> [Path.join([List.to_string(priv_dir), "skills"])]
      {:error, :bad_name} -> []
    end
  end

  defp files(dir) do
    dir = Path.expand(dir)

    [
      Path.join(dir, "**/*.skill.exs"),
      Path.join(dir, "**/skill.exs")
    ]
    |> Enum.flat_map(&Path.wildcard/1)
    |> Enum.uniq()
  end

  defp skill_module?(module) do
    Code.ensure_loaded?(module) and Pi.Skill.Script in behaviours(module)
  end

  defp behaviours(module), do: module.module_info(:attributes) |> Keyword.get(:behaviour, [])

  defp executable(module, path) do
    metadata = module.metadata()
    name = Map.fetch!(metadata, :name)

    %Executable{
      name: name,
      path: path,
      module: module,
      metadata: metadata,
      markdown: module.markdown(),
      apis: normalize_apis(module.apis())
    }
  end

  defp normalize_apis(apis) do
    apis = List.wrap(apis)

    case apis do
      [{key, _value} | _rest] when is_atom(key) -> [API.new(apis)]
      apis -> Enum.map(apis, &API.new/1)
    end
  end

  defp atom_keys_to_strings(map) do
    Map.new(map, fn
      {key, value} when is_atom(key) -> {Atom.to_string(key), value}
      entry -> entry
    end)
  end
end
