defmodule GamepediaWeb.RawBodyPlug do
  @moduledoc """
  Caches the raw request body in conn.private[:raw_body] before
  Plug.Parsers consumes it. Required for webhook signature verification.

  Plug only lets you read the body once; this plug reads it early and
  stashes it so WebhookController can re-read it for HMAC verification.
  """

  @behaviour Plug

  @impl Plug
  def init(opts), do: opts

  @impl Plug
  def call(conn, _opts) do
    case Plug.Conn.read_body(conn, length: 1_000_000) do
      {:ok, body, conn} ->
        Plug.Conn.put_private(conn, :raw_body, body)

      {:more, partial, conn} ->
        # Body too large — store what we have; signature will fail safely.
        Plug.Conn.put_private(conn, :raw_body, partial)

      {:error, _} ->
        Plug.Conn.put_private(conn, :raw_body, "")
    end
  end
end
