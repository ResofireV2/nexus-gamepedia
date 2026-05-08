defmodule GamepediaWeb.PostGameController do
  @moduledoc """
  POST /api/posts/:post_id/games  — link games to a post
  GET  /api/posts/:post_id/games  — list games linked to a post
  """

  use Phoenix.Controller, formats: [:json]

  alias Gamepedia.PostGames

  # ---------------------------------------------------------------------------
  # POST /api/posts/:post_id/games
  # Body: { game_ids: [1, 2, 3] }
  # ---------------------------------------------------------------------------

  def create(conn, %{"post_id" => post_id, "game_ids" => game_ids}) do
    pid  = parse_int(post_id)
    gids = Enum.map(List.wrap(game_ids), &parse_int/1) |> Enum.uniq()

    case PostGames.link_games(pid, gids) do
      :ok ->
        json(conn, %{ok: true})

      {:error, reason} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
    end
  end

  def create(conn, _),
    do: conn |> put_status(:bad_request) |> json(%{error: "Required: game_ids (array)"})

  # ---------------------------------------------------------------------------
  # GET /api/posts/:post_id/games
  # ---------------------------------------------------------------------------

  def index(conn, %{"post_id" => post_id}) do
    games = PostGames.list_games_for_post(parse_int(post_id))
    json(conn, %{data: Enum.map(games, &game_json/1)})
  end

  # ---------------------------------------------------------------------------
  # Private
  # ---------------------------------------------------------------------------

  defp game_json(game) do
    %{
      id:              game.id,
      name:            game.name,
      slug:            game.slug,
      cover_image_url: game.cover_image_url,
      release_year:    release_year(game.first_release_date),
      developer:       game.developer,
      publisher:       game.publisher
    }
  end

  defp release_year(nil), do: nil
  defp release_year(ts) do
    ts |> DateTime.from_unix!() |> Map.get(:year)
  end

  defp parse_int(v) when is_integer(v), do: v
  defp parse_int(v) when is_binary(v) do
    case Integer.parse(v) do
      {i, _} -> i
      :error -> 0
    end
  end
end
