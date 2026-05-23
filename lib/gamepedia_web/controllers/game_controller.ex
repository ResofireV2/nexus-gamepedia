defmodule Gamepedia.GameController do
  use Phoenix.Controller, formats: [:json]
  import Gamepedia.ControllerHelpers

  alias Gamepedia.Games

  # ---------------------------------------------------------------------------
  # IGDB search (admin only)
  #
  # Credentials are read from extension settings on the server. The client
  # never sees or sends them. Gated on admin role because this consumes the
  # site's IGDB API quota — only admins importing games should be allowed
  # to hit it.
  # ---------------------------------------------------------------------------

  def igdb_search(conn, %{"q" => q}) when is_binary(q) and q != "" do
    case require_admin(conn) do
      {:error, :unauthorized} ->
        conn |> put_status(:unauthorized) |> json(%{error: "Not authenticated"})

      {:error, :forbidden} ->
        conn |> put_status(:forbidden) |> json(%{error: "Admin access required"})

      :ok ->
        case Gamepedia.Settings.igdb_credentials() do
          nil ->
            conn
            |> put_status(:service_unavailable)
            |> json(%{error: "IGDB credentials not configured. Set Client ID and Secret in the admin panel."})

          {cid, cs} ->
            case Gamepedia.Igdb.search_games(q, cid, cs) do
              {:ok, games}     -> json(conn, %{data: games})
              {:error, reason} -> conn |> put_status(:bad_gateway) |> json(%{error: reason})
            end
        end
    end
  end

  def igdb_search(conn, _),
    do: conn |> put_status(:bad_request) |> json(%{error: "Required: q (non-empty search query)"})

  # ---------------------------------------------------------------------------
  # Public reads — game library
  # ---------------------------------------------------------------------------

  def index(conn, params) do
    result  = Games.list_games(params)
    filters = Games.filter_options()

    json(conn, %{
      data: Enum.map(result.games, &game_summary/1),
      meta: %{
        total:    result.total,
        page:     result.page,
        pages:    result.pages,
        has_more: result.has_more,
        per_page: 16,
      },
      filters: filters,
    })
  end

  def show(conn, %{"slug" => slug}) do
    case Games.get_game_by_slug(slug) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Game not found"})

      game ->
        user_id        = nexus_user_id(conn)
        rating_summary = Gamepedia.Ratings.summary(game.id)
        user_rating    = if user_id > 0, do: Gamepedia.Ratings.user_rating(user_id, game.id), else: nil
        awards         = Gamepedia.Awards.list_for_game(game.id)
        gamelog_count  = Games.gamelog_count(game.id)
        thread_count   = Gamepedia.PostGames.thread_count(game.id)

        json(conn, %{
          data: game_detail(game, rating_summary, user_rating, awards, gamelog_count, thread_count)
        })
    end
  end

  # ---------------------------------------------------------------------------
  # Shared serializers — also called from AdminGameController
  # ---------------------------------------------------------------------------

  def game_summary(game) do
    %{
      id:              game.id,
      name:            game.name,
      slug:            game.slug,
      cover_image_url: game.cover_image_url,
      release_year:    release_year(game.first_release_date),
      developer:       game.developer,
      genres:          Enum.map(game.genres, &genre_map/1),
    }
  end

  def game_detail(game, rating_summary \\ %{count: 0, avg: nil, distribution: []},
                  user_rating \\ nil, awards \\ [], gamelog_count \\ 0, thread_count \\ 0) do
    %{
      id:                  game.id,
      igdb_id:             game.igdb_id,
      name:                game.name,
      slug:                game.slug,
      summary:             game.summary,
      cover_image_url:     game.cover_image_url,
      trailer_youtube_id:  game.trailer_youtube_id,
      developer:           game.developer,
      publisher:           game.publisher,
      release_year:        release_year(game.first_release_date),
      first_release_date:  game.first_release_date,
      genres:              Enum.map(game.genres, &genre_map/1),
      screenshots:         Enum.map(game.screenshots, &screenshot_map/1),
      rating_avg:          rating_summary.avg,
      rating_count:        rating_summary.count,
      rating_distribution: rating_summary.distribution,
      user_rating:         user_rating,
      awards:              awards,
      gamelog_count:       gamelog_count,
      thread_count:        thread_count,
    }
  end

  defp screenshot_map(s) do
    %{
      id:            s.id,
      igdb_image_id: s.igdb_image_id,
      url:           s.url,
      webp_url:      Games.screenshot_url(s.webp_path),
      jpg_url:       Games.screenshot_url(s.local_path),
      order:         s.order,
    }
  end

  defp genre_map(g), do: %{id: g.id, name: g.name, slug: g.slug}
end
