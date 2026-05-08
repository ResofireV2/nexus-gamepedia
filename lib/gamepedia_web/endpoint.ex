defmodule GamepediaWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :gamepedia

  plug Plug.RequestId
  plug Plug.Telemetry, event_prefix: [:phoenix, :endpoint]

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
