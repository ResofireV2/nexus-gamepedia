import Config

config :gamepedia, Gamepedia.Repo,
  username: "nexus",
  password: "nexus",
  hostname: "localhost",
  database: "gamepedia_test#{System.get_env("MIX_TEST_PARTITION")}",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2

config :gamepedia, GamepediaWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "gamepedia_test_secret_key_base_replace_in_production_min_64_chars",
  server: false

config :logger, level: :warning
config :phoenix, :plug_init_mode, :runtime
