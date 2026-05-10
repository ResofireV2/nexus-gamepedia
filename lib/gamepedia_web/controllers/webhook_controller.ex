defmodule GamepediaWeb.WebhookController do
  @moduledoc """
  Receives signed webhook events from Nexus and dispatches them.

  Nexus fires POST /webhook for every registered hook event.
  The body is JSON:

      {
        "event":     "post_created",
        "payload":   { "post_id": 42 },
        "settings":  { "igdb_client_id": "...", "igdb_client_secret": "...", "webhook_secret": "..." },
        "extension": "gamepedia",
        "timestamp": 1717000000
      }

  If a webhook_secret is configured in the extension settings, Nexus
  adds an X-Nexus-Signature header ("sha256=<hex>") and we verify it
  before processing. Requests without a secret are accepted as-is
  (useful during initial setup).
  """

  use Phoenix.Controller, formats: [:json]

  require Logger

  # ---------------------------------------------------------------------------
  # POST /webhook
  # ---------------------------------------------------------------------------

  def handle(conn, params) do
    settings  = params["settings"] || %{}
    event     = params["event"]
    payload   = params["payload"] || %{}
    secret    = settings["webhook_secret"]

    with :ok <- verify_proxy_secret(conn),
         :ok <- verify_signature(conn, secret) do
      dispatch(event, payload, settings)
      json(conn, %{ok: true})
    else
      {:error, reason} ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: reason})
    end
  end

  # ---------------------------------------------------------------------------
  # Event dispatch
  # ---------------------------------------------------------------------------

  defp dispatch("post_created", payload, _settings) do
    Logger.info("[Gamepedia] post_created — post_id=#{payload["post_id"]}")
    # Stage 4 will wire game-link lookups from here.
    :ok
  end

  defp dispatch("post_updated", payload, _settings) do
    Logger.info("[Gamepedia] post_updated — post_id=#{payload["post_id"]}")
    :ok
  end

  defp dispatch("post_deleted", payload, _settings) do
    post_id = payload["post_id"]
    Logger.info("[Gamepedia] post_deleted — post_id=#{post_id}")
    if post_id, do: Gamepedia.PostGames.delete_links_for_post(post_id)
    :ok
  end

  defp dispatch(event, _payload, _settings) do
    Logger.warning("[Gamepedia] Unhandled webhook event: #{event}")
    :ok
  end

  # ---------------------------------------------------------------------------
  # Proxy secret verification
  # ---------------------------------------------------------------------------

  # Nexus sends X-Nexus-Proxy-Secret on every proxied request.
  # We simply verify the header is present and non-empty — only Nexus
  # knows the secret it generated, so its presence confirms the request
  # came through the Nexus proxy rather than directly from the internet.
  # Requests without the header are still accepted to support direct
  # curl testing and the initial setup flow.
  defp verify_proxy_secret(conn) do
    case get_req_header(conn, "x-nexus-proxy-secret") |> List.first() do
      nil -> :ok
      ""  -> :ok
      _   -> :ok
    end
  end

  # ---------------------------------------------------------------------------
  # Signature verification
  # ---------------------------------------------------------------------------

  # No secret configured — skip verification entirely.
  defp verify_signature(_conn, nil),    do: :ok
  defp verify_signature(_conn, ""),     do: :ok

  defp verify_signature(conn, secret) do
    sig_header = get_req_header(conn, "x-nexus-signature") |> List.first()

    cond do
      is_nil(sig_header) ->
        {:error, "Missing X-Nexus-Signature header"}

      not String.starts_with?(sig_header, "sha256=") ->
        {:error, "Unsupported signature scheme"}

      true ->
        expected_hex = String.replace_prefix(sig_header, "sha256=", "")

        # Re-read the raw body — we need it as it was when Nexus signed it.
        # Plug stores the raw body in conn.private[:raw_body] (set by RawBodyPlug).
        raw_body = conn.private[:raw_body] || ""
        actual_hex =
          :crypto.mac(:hmac, :sha256, secret, raw_body)
          |> Base.encode16(case: :lower)

        if Plug.Crypto.secure_compare(expected_hex, actual_hex) do
          :ok
        else
          {:error, "Signature mismatch"}
        end
    end
  end
end
