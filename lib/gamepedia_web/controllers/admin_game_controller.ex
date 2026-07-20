defmodule Gamepedia.AdminGameController do
  use Phoenix.Controller, formats: [:json]
  import Ecto.Query
  import Gamepedia.ControllerHelpers

  alias Nexus.Repo
  alias Gamepedia.{Games, GameController}
  alias Gamepedia.Games.Game

  # ---------------------------------------------------------------------------
  # Auth guards
  # ---------------------------------------------------------------------------

  defp admin_required(conn, action) do
    case require_admin(conn) do
      :ok ->
        action.(conn)

      {:error, :unauthorized} ->
        conn |> put_status(:unauthorized) |> json(%{error: "Not authenticated"})

      {:error, :forbidden} ->
        conn |> put_status(:forbidden) |> json(%{error: "Admin access required"})
    end
  end

  # Resolves IGDB creds from extension settings and runs `fun` with them, or
  # responds 503 if creds are missing. Used by import + refresh which both
  # need IGDB access.
  defp with_igdb_credentials(conn, fun) do
    case Gamepedia.Settings.igdb_credentials() do
      nil ->
        conn
        |> put_status(:service_unavailable)
        |> json(%{error: "IGDB credentials not configured. Set Client ID and Secret in the Credentials tab."})

      {cid, cs} ->
        fun.(cid, cs)
    end
  end

  # ---------------------------------------------------------------------------
  # Actions
  # ---------------------------------------------------------------------------

  def import(conn, %{"igdb_id" => igdb_id}) do
    admin_required(conn, fn conn ->
      with_igdb_credentials(conn, fn cid, cs ->
        case Games.import_game(parse_int(igdb_id), cid, cs) do
          {:ok, game} ->
            conn |> put_status(:created) |> json(%{data: GameController.game_summary(game)})

          {:error, :already_exists} ->
            conn |> put_status(:unprocessable_entity) |> json(%{error: "This game has already been imported"})

          {:error, :not_found} ->
            conn |> put_status(:not_found) |> json(%{error: "Game not found on IGDB"})

          {:error, reason} when is_binary(reason) ->
            conn |> put_status(:bad_gateway) |> json(%{error: reason})

          {:error, changeset} ->
            conn |> put_status(:unprocessable_entity) |> json(%{error: format_errors(changeset)})
        end
      end)
    end)
  end

  def import(conn, _),
    do: conn |> put_status(:bad_request) |> json(%{error: "Required: igdb_id"})

  def refresh(conn, %{"id" => id}) do
    admin_required(conn, fn conn ->
      with_igdb_credentials(conn, fn cid, cs ->
        case Games.refresh_game(parse_int(id), cid, cs) do
          {:ok, game} ->
            json(conn, %{data: GameController.game_summary(game)})

          {:error, :not_found} ->
            conn |> put_status(:not_found) |> json(%{error: "Game not found"})

          {:error, reason} when is_binary(reason) ->
            conn |> put_status(:bad_gateway) |> json(%{error: reason})
        end
      end)
    end)
  end

  def update_genres(conn, %{"id" => id, "genre_ids" => genre_ids}) do
    admin_required(conn, fn conn ->
      ids = Enum.map(genre_ids, &parse_int/1)
      case Games.update_game_genres(parse_int(id), ids) do
        {:ok, _}             -> json(conn, %{ok: true})
        {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "Game not found"})
        {:error, changeset}  -> conn |> put_status(:unprocessable_entity) |> json(%{error: format_errors(changeset)})
      end
    end)
  end

  def update_genres(conn, _),
    do: conn |> put_status(:bad_request) |> json(%{error: "Required: genre_ids (array)"})

  def delete(conn, %{"id" => id}) do
    admin_required(conn, fn conn ->
      case Games.delete_game(parse_int(id)) do
        {:ok, _}             -> json(conn, %{ok: true})
        {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "Game not found"})
      end
    end)
  end

  def index(conn, params) do
    admin_required(conn, fn conn ->
      search = params["search"] || ""
      genre  = params["genre"]  || ""
      sort   = params["sort"]   || "newest"
      page   = max(1, parse_int(params["page"] || 1))
      limit  = 16

      base =
        from(g in Game,
          left_join: gg in "gamepedia_game_genre", on: gg.game_id == g.id,
          left_join: gen in "gamepedia_genres",    on: gen.id == gg.genre_id,
          select: g, distinct: true,
          preload: [:genres]
        )

      base = if search != "", do: where(base, [g], ilike(g.name, ^"%#{search}%")), else: base
      base = if genre  != "", do: where(base, [g, gg, gen], gen.slug == ^genre),   else: base
      base = case sort do
        "az"     -> order_by(base, [g], asc:  g.name)
        "za"     -> order_by(base, [g], desc: g.name)
        "oldest" -> order_by(base, [g], asc:  g.inserted_at)
        _        -> order_by(base, [g], desc: g.inserted_at)
      end

      total  = Repo.aggregate(base, :count)
      games  = base |> offset((^page - 1) * ^limit) |> limit(^limit) |> Repo.all()
      genres = Repo.all(from g in "gamepedia_genres", order_by: g.name,
                        select: %{id: g.id, name: g.name, slug: g.slug})

      # Distinct release years computed in Postgres. This previously selected
      # every game's first_release_date, converted each with DateTime.from_unix!
      # and de-duplicated in Elixir — a full-table read on every admin page
      # load. Gamepedia.Games.filter_options/0 already did it correctly in SQL.
      years = Games.release_years()

      json(conn, %{
        data:    Enum.map(games, &game_summary_with_genres/1),
        meta:    %{total: total, per_page: limit, current_page: page, has_more: page * limit < total},
        filters: %{genres: genres, years: years},
      })
    end)
  end

  def stats(conn, _params) do
    admin_required(conn, fn conn ->
      total_games       = Repo.aggregate(Game, :count)
      total_screenshots = Repo.aggregate("gamepedia_screenshots", :count)
      total_gamelogs    = Repo.aggregate("gamepedia_gamelogs", :count)
      games_no_genre    = Repo.aggregate(
        from(g in Game, where: g.id not in subquery(from gg in "gamepedia_game_genre", select: gg.game_id)),
        :count)
      games_no_cover = Repo.aggregate(from(g in Game, where: is_nil(g.cover_image_url)), :count)
      top_games =
        Repo.all(from g in Game,
          join: gl in "gamepedia_gamelogs", on: gl.game_id == g.id,
          group_by: [g.id, g.name],
          order_by: [desc: count(gl.id)],
          limit: 5,
          select: %{id: g.id, name: g.name, gamelog_count: count(gl.id)})

      json(conn, %{data: %{
        total_games:       total_games,
        total_screenshots: total_screenshots,
        estimated_disk_mb: Float.round(total_screenshots * 80 / 1024, 1),
        games_no_genre:    games_no_genre,
        games_no_cover:    games_no_cover,
        total_gamelogs:    total_gamelogs,
        top_gamelog_games: top_games,
      }})
    end)
  end

  # Genres come from the query's preload rather than a per-game lookup. The
  # previous version issued one genre query per row, so a 16-row admin page
  # cost 16 extra round-trips.
  defp game_summary_with_genres(game) do
    %{
      id: game.id, igdb_id: game.igdb_id, name: game.name, slug: game.slug,
      cover_image_url: game.cover_image_url, developer: game.developer,
      release_year: release_year(game.first_release_date),
      genres: Enum.map(game.genres, &%{id: &1.id, name: &1.name, slug: &1.slug}),
    }
  end
end
