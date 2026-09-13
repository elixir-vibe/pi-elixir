defmodule PiBridge.MixProject do
  use Mix.Project

  def project do
    [
      app: :pi_bridge,
      version: "0.8.5",
      elixir: "~> 1.16",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      description: "BEAM runtime bridge for pi development agents",
      package: package(),
      source_url: "https://github.com/elixir-vibe/pi-elixir",
      docs: [main: "readme", extras: ["README.md", "docs/architecture.md", "docs/protocol.md"]],
      elixirc_options: [
        no_warn_undefined: [
          {Dune, :eval_string, 2},
          {ReqLLM, :model!, 1},
          {ReqLLM.Providers, :register, 1}
        ]
      ],
      aliases: aliases(),
      dialyzer: [
        plt_file: {:no_warn, "_build/dev/dialyxir_plt.plt"},
        plt_add_apps: [:mix, :reach]
      ],
      deps: deps()
    ]
  end

  def cli do
    [preferred_envs: [ci: :test]]
  end

  def application do
    [mod: {Pi.Application, []}, extra_applications: [:logger]]
  end

  defp elixirc_paths(_env), do: ["lib", "priv/target/runtime"]

  defp aliases do
    [
      ci: [
        "compile --warnings-as-errors",
        "format --check-formatted",
        "test",
        "credo --strict",
        "dialyzer",
        "ex_dna --max-clones 0",
        "reach.check --arch --smells --strict"
      ]
    ]
  end

  defp package do
    [
      licenses: ["MIT"],
      links: %{"GitHub" => "https://github.com/elixir-vibe/pi-elixir"},
      files: ~w[lib priv docs mix.exs README.md]
    ]
  end

  defp deps do
    [
      {:jason, "~> 1.4"},
      {:json_codec, "~> 0.2.3"},
      {:lumis, "~> 0.6.1"},
      {:ex_ast, "~> 0.12.10"},
      {:floki, "~> 0.38.4"},
      {:req, "~> 0.5"},
      {:quackdb, "~> 0.5.4"},
      {:ecto_sql, "~> 3.13"},
      {:req_llm, "~> 1.6", optional: true},
      {:dune, "~> 0.3", optional: true},
      {:bandit, "~> 1.8"},
      {:plug, "~> 1.18"},
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
      {:dialyxir, "~> 1.4", only: [:dev, :test], runtime: false},
      {:ex_dna, "~> 1.5", only: [:dev, :test], runtime: false},
      {:ex_slop, "~> 0.4", only: [:dev, :test], runtime: false},
      {:reach, "~> 2.6", runtime: false},
      {:ex_doc, "~> 0.34", only: :dev, runtime: false}
    ]
  end
end
