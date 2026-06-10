defmodule Pi.Web.Result do
  @moduledoc "Normalized result for a bounded web fetch."

  defstruct url: "",
            final_url: nil,
            status: nil,
            content_type: nil,
            format: :text,
            title: nil,
            text: "",
            size_bytes: 0,
            total_chars: 0,
            truncated?: false,
            redirected?: false,
            metadata: %{}

  @type format :: :text | :html | :json | :markdown

  @type t :: %__MODULE__{
          url: String.t(),
          final_url: String.t() | nil,
          status: pos_integer() | nil,
          content_type: String.t() | nil,
          format: format(),
          title: String.t() | nil,
          text: String.t(),
          size_bytes: non_neg_integer(),
          total_chars: non_neg_integer(),
          truncated?: boolean(),
          redirected?: boolean(),
          metadata: map()
        }
end
