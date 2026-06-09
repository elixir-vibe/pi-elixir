defmodule Pi.Eval.Snapshot do
  @moduledoc "Sidecar representation for durable eval session state snapshots."

  @version 1
  @default_max_bytes 10 * 1_024 * 1_024

  @type t :: %{binding: Code.binding(), env: Macro.Env.t(), metadata: map()}

  @spec load(Path.t() | nil) :: {:ok, t()} | :error
  def load(nil), do: :error

  def load(path) when is_binary(path) do
    with true <- File.regular?(path),
         {:ok, binary} <- File.read(path),
         {:ok, decoded} <- decode(binary) do
      {:ok, decoded}
    else
      _ -> :error
    end
  end

  @spec store(Path.t() | nil, Code.binding(), Macro.Env.t(), keyword()) ::
          {:ok, map()} | {:error, term()}
  def store(nil, _binding, %Macro.Env{}, _opts), do: {:ok, %{persisted?: false}}

  def store(path, binding, %Macro.Env{} = env, opts) when is_binary(path) and is_list(binding) do
    max_bytes = Keyword.get(opts, :max_bytes, max_bytes())
    {persisted_binding, dropped} = shrink_binding(binding, env, max_bytes)
    payload = payload(persisted_binding, env, dropped)
    binary = :erlang.term_to_binary(payload)

    with :ok <- File.mkdir_p(Path.dirname(path)),
         :ok <- atomic_write(path, binary),
         :ok <- write_meta(path, payload, byte_size(binary)) do
      {:ok,
       %{
         persisted?: true,
         path: path,
         bytes: byte_size(binary),
         binding_count: length(persisted_binding),
         dropped_bindings: dropped
       }}
    end
  rescue
    exception in [ArgumentError, ErlangError, File.Error, Jason.EncodeError] ->
      {:error, exception}
  end

  @spec binding_info(Code.binding()) :: [map()]
  def binding_info(binding) when is_list(binding) do
    Enum.map(binding, fn {name, value} ->
      %{
        name: name,
        type: value_type(value),
        bytes: value_bytes(value),
        preview: inspect(value, charlists: :as_lists, limit: 20, pretty: true)
      }
    end)
  end

  @spec serializable_binding(Code.binding()) :: Code.binding()
  def serializable_binding(binding) when is_list(binding) do
    Enum.filter(binding, fn {_name, value} -> serializable_term?(value) end)
  end

  defp decode(binary) when is_binary(binary) do
    case :erlang.binary_to_term(binary, [:safe]) do
      %{version: @version, binding: binding, env: %Macro.Env{} = env} = payload ->
        {:ok, %{binding: binding, env: env, metadata: Map.get(payload, :metadata, %{})}}

      _other ->
        :error
    end
  rescue
    _exception in [ArgumentError] -> :error
  end

  defp payload(binding, env, dropped) do
    %{
      version: @version,
      binding: binding,
      env: env,
      metadata: %{
        bridge_version: bridge_version(),
        elixir_version: System.version(),
        otp_release: System.otp_release(),
        updated_at: DateTime.utc_now(),
        dropped_bindings: dropped
      }
    }
  end

  defp shrink_binding(binding, env, max_bytes) do
    binding = serializable_binding(binding)
    binary = :erlang.term_to_binary(payload(binding, env, []))

    if byte_size(binary) <= max_bytes do
      {binding, []}
    else
      drop_until_fits(binding, env, max_bytes, [])
    end
  end

  defp drop_until_fits([], _env, _max_bytes, dropped), do: {[], Enum.reverse(dropped)}

  defp drop_until_fits(binding, env, max_bytes, dropped) do
    {name, _value} = largest_binding(binding)
    kept = Keyword.delete(binding, name)
    dropped = [name | dropped]
    binary = :erlang.term_to_binary(payload(kept, env, dropped))

    if byte_size(binary) <= max_bytes do
      {kept, Enum.reverse(dropped)}
    else
      drop_until_fits(kept, env, max_bytes, dropped)
    end
  end

  defp largest_binding(binding),
    do: Enum.max_by(binding, fn {_name, value} -> value_bytes(value) end)

  defp atomic_write(path, binary) do
    tmp = path <> ".tmp-" <> Integer.to_string(System.unique_integer([:positive]))

    try do
      case File.write(tmp, binary) do
        :ok -> File.rename(tmp, path)
        {:error, reason} -> {:error, reason}
      end
    after
      File.rm(tmp)
    end
  end

  defp write_meta(path, payload, bytes) do
    metadata = %{
      version: @version,
      bytes: bytes,
      bindingCount: length(payload.binding),
      bindings:
        Enum.map(payload.binding, fn {name, value} ->
          %{name: to_string(name), type: to_string(value_type(value))}
        end),
      droppedBindings: Enum.map(payload.metadata.dropped_bindings, &to_string/1),
      updatedAt: DateTime.to_iso8601(payload.metadata.updated_at),
      bridgeVersion: payload.metadata.bridge_version,
      elixirVersion: payload.metadata.elixir_version,
      otpRelease: payload.metadata.otp_release
    }

    File.write(path <> ".meta.json", Jason.encode!(metadata))
  end

  defp max_bytes do
    Application.get_env(:pi_bridge, :eval_state_max_bytes, @default_max_bytes)
  end

  defp bridge_version do
    case Application.spec(:pi_bridge, :vsn) do
      nil -> "unknown"
      version -> to_string(version)
    end
  end

  defp value_type(%module{}), do: module
  defp value_type(value) when is_binary(value), do: :binary
  defp value_type(value) when is_boolean(value), do: :boolean
  defp value_type(value) when is_atom(value), do: :atom
  defp value_type(value) when is_integer(value), do: :integer
  defp value_type(value) when is_float(value), do: :float
  defp value_type(value) when is_list(value), do: :list
  defp value_type(value) when is_tuple(value), do: :tuple
  defp value_type(value) when is_map(value), do: :map
  defp value_type(value) when is_function(value), do: :function
  defp value_type(value) when is_pid(value), do: :pid
  defp value_type(value) when is_port(value), do: :port
  defp value_type(value) when is_reference(value), do: :reference
  defp value_type(_value), do: :term

  defp value_bytes(value) do
    value |> :erlang.term_to_binary() |> byte_size()
  rescue
    _exception in [ArgumentError] -> byte_size(inspect(value, limit: 20))
  end

  defp serializable_term?(term)
       when is_pid(term) or is_port(term) or is_reference(term) or is_function(term),
       do: false

  defp serializable_term?(term) when is_list(term), do: Enum.all?(term, &serializable_term?/1)

  defp serializable_term?(term) when is_tuple(term) do
    term |> Tuple.to_list() |> Enum.all?(&serializable_term?/1)
  end

  defp serializable_term?(%_module{} = term),
    do: term |> Map.from_struct() |> serializable_term?()

  defp serializable_term?(term) when is_map(term) do
    Enum.all?(term, fn {key, value} -> serializable_term?(key) and serializable_term?(value) end)
  end

  defp serializable_term?(_term), do: true
end
