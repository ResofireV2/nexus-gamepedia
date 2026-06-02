defmodule Gamepedia.PostGameController do
  @moduledoc """
  Read endpoints for the post ↔ game association table.

  Writes are NOT served here. Linking games to a post happens through the
  composer attach() flow: the toolbar button calls attach({kind, data})
  client-side, Nexus dispatches each attachment to
  `Gamepedia.persist_attachment/3` after the post is committed. That callback
  is the only writer of `gamepedia_post_game` rows that originate from user
  action.

  Cleanup on post deletion is handled by `Gamepedia.PostGames.delete_links_for_post/1`,
  invoked from `Gamepedia.handle_event("post_deleted", ...)`.
  """

  use Phoenix.Controller, formats: [:json]
  import Gamepedia.ControllerHelpers
  alias Gamepedia.PostGames
  alias Gamepedia.Games

  # GET /posts/:post_id/games — list games linked to a post
  def index(conn, %{"post_id" => post_id}) do
    games = PostGames.list_games_for_post(parse_int(post_id))
    json(conn, %{data: Enum.map(games, &game_json/1)})
  end

  # GET /games/:game_id/posts — list posts that link to a game
  def posts_for_game(conn, %{"game_id" => game_id}) do
    json(conn, %{data: PostGames.list_posts_for_game(parse_int(game_id))})
  end

  defp game_json(g) do
    first_screenshot = List.first(g.screenshots)

    %{
      id:                   g.id,
      name:                 g.name,
      slug:                 g.slug,
      cover_image_url:      g.cover_image_url,
      release_year:         release_year(g.first_release_date),
      developer:            g.developer,
      publisher:            g.publisher,
      first_screenshot_url: screenshot_url(first_screenshot),
    }
  end

  defp screenshot_url(nil), do: nil
  defp screenshot_url(s) do
    Games.screenshot_url(s.webp_path) || s.url
  end
end
