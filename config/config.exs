import Config

config :gamepedia,
  ecto_repos: [Gamepedia.Repo]

config :gamepedia, GamepediaWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Phoenix.Endpoint.Cowboy2Adapter,
  render_errors: [
    formats: [json: GamepediaWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Gamepedia.PubSub,
  live_view: [signing_salt: "gamepedia_lv"]

config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

config :phoenix, :json_library, Jason

import_config "#{config_env()}.exs"
