defmodule Gamepedia.MixProject do
  use Mix.Project

  def project do
    [
      app:     :gamepedia,
      version: "1.5.0",
      elixir:  "~> 1.17",
      # Library — not a standalone application.
      # Compiled and loaded into the running Nexus VM at install time.
      elixirc_paths: ["lib"],
    ]
  end

  # No application callback — Nexus manages supervision.
  def application do
    [extra_applications: [:logger]]
  end
end
