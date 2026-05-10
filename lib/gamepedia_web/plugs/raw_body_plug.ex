defmodule GamepediaWeb.RawBodyPlug do
  @moduledoc """
  Caches the raw request body in conn.private[:raw_body] for webhook
  HMAC signature verification — but ONLY on the /webhook path.

  Running this on all paths would consume the body before Plug.Parsers
  can parse it, causing all POST/PATCH API endpoints to receive empty params.
  """

  @behaviour Plug

  @impl Plug
  def init(opts), do: opts

  @impl Plug
  def call(%{request_path: "/webhook"} = conn, _opts) do
    case Plug.Conn.read_body(conn, length: 1_000_000) do
      {:ok, body, conn}      -> Plug.Conn.put_private(conn, :raw_body, body)
      {:more, partial, conn} -> Plug.Conn.put_private(conn, :raw_body, partial)
      {:error, _}            -> Plug.Conn.put_private(conn, :raw_body, "")
    end
  end

  def call(conn, _opts), do: conn
end
