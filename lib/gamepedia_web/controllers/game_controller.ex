defmodule GamepediaWeb.GameController do
  use Phoenix.Controller, formats: [:json]

  @doc """
  GET /api/games/search?q=elden+ring&client_id=xxx&client_secret=yyy

  Stage 1: credentials passed as query params for direct testing.
  Stage 2+: credentials come from stored extension settings.
  """
  def search(conn, %{"q" => q, "client_id" => client_id, "client_secret" => client_secret}) do
    case Gamepedia.Igdb.search_games(q, client_id, client_secret) do
      {:ok, games} ->
        json(conn, %{games: games})

      {:error, reason} ->
        conn
        |> put_status(:bad_gateway)
        |> json(%{error: reason})
    end
  end

  def search(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "Required params: q, client_id, client_secret"})
  end
end
