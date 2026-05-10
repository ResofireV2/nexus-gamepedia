defmodule Gamepedia.MixProject do
  use Mix.Project

  def project do
    [
      app: :gamepedia,
      version: "0.1.0",
      elixir: "~> 1.17",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      aliases: aliases(),
      deps: deps(),
      releases: [
        gamepedia: [
          include_executables_for: [:unix],
          applications: [runtime_tools: :permanent],
          steps: [:assemble],
          strip_beams: false
        ]
      ]
    ]
  end

  def application do
    [
      mod: {Gamepedia.Application, []},
      extra_applications: [:logger, :runtime_tools]
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    [
      # Phoenix core
      {:phoenix, "~> 1.7"},
      {:phoenix_ecto, "~> 4.6"},
      {:ecto_sql, "~> 3.12"},
      {:postgrex, "~> 0.19"},
      {:phoenix_html, "~> 4.1"},
      {:phoenix_live_reload, "~> 1.2", only: :dev},
      {:phoenix_live_view, "~> 1.0"},
      {:floki, ">= 0.30.0", only: :test},

      # HTTP client — for IGDB API calls
      {:req, "~> 0.5"},

      # Image processing — WebP conversion for screenshots (uses libvips via vix)
      {:image, "~> 0.54"},

      # JSON
      {:jason, "~> 1.4"},

      # Plug
      {:plug_cowboy, "~> 2.7"},

      # Test
      {:phoenix_test, "~> 0.4", only: :test, runtime: false}
    ]
  end

  defp aliases do
    [
      setup: ["deps.get", "ecto.setup"],
      "ecto.setup": ["ecto.create", "ecto.migrate"],
      "ecto.reset": ["ecto.drop", "ecto.setup"],
      test: ["ecto.create --quiet", "ecto.migrate --quiet", "test"]
    ]
  end
end
