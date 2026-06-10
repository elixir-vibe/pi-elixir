defmodule Pi.Quack.Event do
  @moduledoc "Ecto schema for the pi-elixir QuackDB mirror `pi_events` table."

  use Ecto.Schema

  @primary_key false
  schema "pi_events" do
    field(:id, :string)
    field(:event_type, :string)
    field(:cwd, :string)
    field(:session_file, :string)
    field(:session_name, :string)
    field(:leaf_id, :string)
    field(:turn_index, :integer)
    field(:tool_name, :string)
    field(:tool_call_id, :string)
    field(:is_error, :boolean)
    field(:occurred_at, :naive_datetime)
    field(:payload_json, :string)
  end
end
