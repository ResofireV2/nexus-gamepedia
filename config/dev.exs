import Config

config :gamepedia, Gamepedia.Repo,
  username: "nexus",
  password: "nexus",
  hostname: "localhost",
  database: "nexus_dev",
  stacktrace: true,
  show_sensitive_data_on_connection_error: true,
  pool_size: 10

config :gamepedia, GamepediaWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4001],
  check_origin: false,
  code_reloader: true,
  debug_errors: true,
  secret_key_base: "gamepedia_dev_secret_key_base_replace_in_production_min_64_chars",
  watchers: []

config :logger, level: :debug

config :phoenix, :stacktrace_depth, 20
config :phoenix, :plug_init_mode, :runtime
