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

  # Serve locally stored game screenshots from the bind-mounted directory.
  plug Plug.Static,
    at: "/screenshots",
    from: Application.compile_env(:gamepedia, :screenshots_dir, "/app/screenshots"),
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
