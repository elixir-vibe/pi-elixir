defmodule Pi.Dev do
  @moduledoc "Small dogfood/dev reload helpers callable from elixir_eval."

  alias Pi.LLM.Broker

  @default_prefixes ["Elixir.Pi"]

  @doc "Returns compact development reload status."
  def status(_opts \\ []) do
    %{
      app: Mix.Project.config()[:app],
      env: Mix.env(),
      bridge_version: Application.spec(:pi_bridge, :vsn) |> to_string(),
      loaded_modules: loaded() |> length(),
      restart_hint:
        "Use /elixir:restart to restart embedded BEAM; /elixir:refresh to refresh pi + BEAM."
    }
  end

  @doc "Compiles the current Mix project."
  def compile(opts \\ []) do
    args = if Keyword.get(opts, :force, false), do: ["--force"], else: []
    compile_args = Keyword.get(opts, :args, args)

    Mix.Task.clear()

    try do
      modules = Mix.Task.run("compile", compile_args) |> normalize_modules()
      {:ok, %{modules: modules, count: length(modules)}}
    rescue
      exception in [Mix.Error, CompileError, RuntimeError, ArgumentError] ->
        {:error,
         %{kind: :compile_error, message: Exception.format(:error, exception, __STACKTRACE__)}}
    catch
      :exit, reason -> {:error, %{kind: :compile_exit, reason: inspect(reason)}}
    end
  end

  @doc "Compiles and soft-reloads matching BEAM modules."
  def reload(opts \\ []) do
    with {:ok, %{modules: modules} = compile_report} <-
           compile(Keyword.put_new(opts, :force, true)) do
      modules = reloadable_modules(modules, opts)
      warnings = Enum.flat_map(modules, &reload_module/1)
      {:ok, Map.merge(compile_report, %{reloaded: modules, warnings: warnings})}
    end
  end

  @doc "Returns loaded modules matching optional prefixes."
  def loaded(opts \\ []) do
    prefixes = Keyword.get(opts, :prefixes, @default_prefixes)

    :code.all_loaded()
    |> Enum.map(&elem(&1, 0))
    |> Enum.filter(&prefixed?(&1, prefixes))
    |> Enum.sort()
  end

  @doc "Requests pi to perform a process or extension reload after the current eval returns."
  def request(action, opts \\ []) when action in [:beam_restart, :pi_reload, :dev_reload] do
    timeout = Keyword.get(opts, :timeout, 1_000)
    Broker.request(:dev_reload, %{action: Atom.to_string(action)}, timeout)
  end

  @doc "Requests pi to restart the embedded BEAM bridge after the current eval returns."
  def restart(opts \\ []), do: request(:beam_restart, opts)

  @doc "Requests pi to refresh the dev environment after the current eval returns."
  def refresh(opts \\ []), do: request(:dev_reload, opts)

  defp normalize_modules({:ok, modules}) when is_list(modules), do: modules
  defp normalize_modules(modules) when is_list(modules), do: modules
  defp normalize_modules(_other), do: []

  defp reloadable_modules([], opts), do: loaded(opts)

  defp reloadable_modules(modules, opts),
    do: Enum.filter(modules, &prefixed?(&1, Keyword.get(opts, :prefixes, @default_prefixes)))

  defp prefixed?(module, prefixes) do
    name = to_string(module)
    Enum.any?(prefixes, &String.starts_with?(name, &1))
  end

  defp reload_module(module) do
    if :code.soft_purge(module) do
      :code.delete(module)
      :code.ensure_loaded(module)
      []
    else
      [{:old_code_still_running, module}]
    end
  end
end
