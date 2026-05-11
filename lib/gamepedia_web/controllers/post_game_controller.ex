defmodule Gamepedia.PostGameController do
  use Phoenix.Controller, formats: [:json]
  import Gamepedia.ControllerHelpers
  alias Gamepedia.PostGames

  def create(conn, %{"post_id" => post_id, "game_ids" => game_ids}) do
    gids = Enum.map(List.wrap(game_ids), &parse_int/1) |> Enum.uniq()
    case PostGames.link_games(parse_int(post_id), gids) do
      :ok              -> json(conn, %{ok: true})
      {:error, reason} -> conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
    end
  end
  def create(conn, _), do: conn |> put_status(:bad_request) |> json(%{error: "Required: game_ids (array)"})

  def index(conn, %{"post_id" => post_id}) do
    games = PostGames.list_games_for_post(parse_int(post_id))
    json(conn, %{data: Enum.map(games, &game_json/1)})
  end

  def posts_for_game(conn, %{"game_id" => game_id}) do
    json(conn, %{data: PostGames.list_posts_for_game(parse_int(game_id))})
  end

  defp game_json(g) do
    %{id: g.id, name: g.name, slug: g.slug, cover_image_url: g.cover_image_url,
      release_year: release_year(g.first_release_date), developer: g.developer, publisher: g.publisher}
  end
end
