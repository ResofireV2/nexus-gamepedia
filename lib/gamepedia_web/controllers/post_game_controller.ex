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
  alias Gamepedia.Awards
  alias Gamepedia.Ratings

  # GET /posts/:post_id/games — list games linked to a post
  def index(conn, %{"post_id" => post_id}) do
    games = PostGames.list_games_for_post(parse_int(post_id))
    json(conn, %{data: serialize_games(games)})
  end

  # GET /games/:game_id/posts — list posts that link to a game
  def posts_for_game(conn, %{"game_id" => game_id}) do
    json(conn, %{data: PostGames.list_posts_for_game(parse_int(game_id))})
  end

  # ---------------------------------------------------------------------------
  # Serialization
  #
  # Every per-game figure is fetched for the whole set in one query before the
  # map, rather than per game inside it. The previous version called
  # Ratings.summary/1, Awards.list_for_game/1, Games.gamelog_count/1 and
  # PostGames.thread_count/1 from inside the Enum.map — four queries per game,
  # one of which loaded every rating row — so a post linked to three games
  # issued around fifteen queries, on both the footer slot and the sidebar
  # widget.
  # ---------------------------------------------------------------------------

  defp serialize_games([]), do: []

  defp serialize_games(games) do
    ids            = Enum.map(games, & &1.id)
    rating_summary = Ratings.summaries_for_games(ids)
    awards         = Awards.list_for_games(ids)
    gamelog_counts = Games.gamelog_counts(ids)
    thread_counts  = PostGames.thread_counts(ids)

    Enum.map(games, fn g ->
      summary = Map.get(rating_summary, g.id, %{avg: nil, count: 0})

      %{
        id:                   g.id,
        name:                 g.name,
        slug:                 g.slug,
        cover_image_url:      g.cover_image_url,
        release_year:         release_year(g.first_release_date),
        developer:            g.developer,
        publisher:            g.publisher,
        genres:               Enum.map(g.genres, fn genre -> %{id: genre.id, name: genre.name} end),
        first_screenshot_url: screenshot_url(List.first(g.screenshots)),
        rating_avg:           summary.avg,
        rating_count:         summary.count,
        awards:               Map.get(awards, g.id, []),
        gamelog_count:        Map.get(gamelog_counts, g.id, 0),
        thread_count:         Map.get(thread_counts, g.id, 0),
      }
    end)
  end

  defp screenshot_url(nil), do: nil
  defp screenshot_url(s) do
    Games.screenshot_url(s.webp_path) || s.url
  end
end
