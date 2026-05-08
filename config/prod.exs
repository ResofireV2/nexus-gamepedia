import Config

config :gamepedia, GamepediaWeb.Endpoint,
  cache_static_manifest: "priv/static/cache_manifest.json",
  server: true

config :logger, level: :info

config :phoenix, :serve_endpoints, true
