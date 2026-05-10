defmodule GamepediaWeb.GameController do
  use Phoenix.Controller, formats: [:json]

  alias Gamepedia.Games

  # ---------------------------------------------------------------------------
  # Stage 1 — IGDB search
  # GET /api/games/search?q=&client_id=&client_secret=
  # ---------------------------------------------------------------------------

  def igdb_search(conn, %{"q" => q, "client_id" => cid, "client_secret" => cs}) do
    case Gamepedia.Igdb.search_games(q, cid, cs) do
      {:ok, games} -> json(conn, %{data: games})
      {:error, reason} -> conn |> put_status(:bad_gateway) |> json(%{error: reason})
    end
  end

  def igdb_search(conn, _), do:
    conn |> put_status(:bad_request) |> json(%{error: "Required: q, client_id, client_secret"})

  # ---------------------------------------------------------------------------
  # Stage 2 — Public game library
  # GET /api/games
  # ---------------------------------------------------------------------------

  def index(conn, params) do
    result  = Games.list_games(params)
    filters = Games.filter_options()

    json(conn, %{
      data: Enum.map(result.games, &game_summary/1),
      meta: %{
        total:        result.total,
        page:         result.page,
        pages:        result.pages,
        has_more:     result.has_more,
        per_page:     16
      },
      filters: filters
    })
  end

  # GET /api/games/:slug
  def show(conn, %{"slug" => slug}) do
    case Games.get_game_by_slug(slug) do
      nil  -> conn |> put_status(:not_found) |> json(%{error: "Game not found"})
      game -> json(conn, %{data: game_detail(game)})
    end
  end

  # ---------------------------------------------------------------------------
  # JSON helpers
  # ---------------------------------------------------------------------------

  def game_summary(game) do
    %{
      id:              game.id,
      name:            game.name,
      slug:            game.slug,
      cover_image_url: game.cover_image_url,
      release_year:    Games.Game.release_year(game),
      developer:       game.developer,
      genres:          Enum.map(game.genres, &genre_map/1)
    }
  end

  def game_detail(game) do
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
      release_year:        Games.Game.release_year(game),
      first_release_date:  game.first_release_date,
      genres:              Enum.map(game.genres, &genre_map/1),
      screenshots:         Enum.map(game.screenshots, fn s ->
        %{id: s.id, igdb_image_id: s.igdb_image_id, url: s.url, order: s.order}
      end)
    }
  end

  defp genre_map(g), do: %{id: g.id, name: g.name, slug: g.slug}
end
