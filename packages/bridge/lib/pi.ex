defmodule Pi do
  @moduledoc "Small eval-friendly helpers for pi-elixir."

  @doc "Returns compact project/runtime metadata."
  def project, do: Pi.Project.info()

  @doc "Returns bounded captured logs from the embedded server logger."
  def logs(opts \\ []), do: Pi.LogCapture.get_logs(Keyword.get(opts, :tail, 50), opts)

  @doc "Clears embedded server logs."
  def clear_logs, do: Pi.LogCapture.clear_logs()
end
