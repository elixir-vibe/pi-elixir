defmodule Pi.Quack.SessionFile do
  @moduledoc "Ecto schema for the pi-elixir QuackDB mirror `pi_session_files` table."

  use Ecto.Schema

  @primary_key false
  schema "pi_session_files" do
    field(:session_file, :string)
    field(:file_size, :integer)
    field(:mtime_seconds, :integer)
    field(:synced_entries, :integer)
    field(:synced_at, :naive_datetime)
  end
end
