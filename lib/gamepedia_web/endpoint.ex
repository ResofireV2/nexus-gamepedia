defmodule GamepediaWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :gamepedia

  plug Plug.RequestId
  plug Plug.Telemetry, event_prefix: [:phoenix, :endpoint]

  # Serve static assets from priv/static — this is where the JS bundle lives.
  plug Plug.Static,
    at: "/assets",
    from: {:gamepedia, "priv/static/assets"},
    gzip: true,
    headers: %{"access-control-allow-origin" => "*"}

  # Serve locally stored game screenshots via /assets/screenshots/*.
  # The Nexus extension proxy forwards /api/v1/extensions/gamepedia/assets/*
  # to this service at /assets/*, so screenshots are reached at:
  # /api/v1/extensions/gamepedia/assets/screenshots/{filename}
  plug Plug.Static,
    at: "/assets/screenshots",
    from: "/app/screenshots",
    gzip: false

  # Must come before Plug.Parsers so the raw body is still available for
  # webhook HMAC signature verification.
  plug GamepediaWeb.RawBodyPlug

  plug Plug.Parsers,
    parsers: [:urlencoded, :multipart, :json],
    pass: ["*/*"],
    json_decoder: Phoenix.json_library()

  plug Plug.MethodOverride
  plug Plug.Head

  plug GamepediaWeb.Router
end
