defmodule Gamepedia.Games do
  @moduledoc """
  Games context. Handles all database operations for games and screenshots.
  """

  import Ecto.Query
  alias Gamepedia.Repo
  alias Gamepedia.Games.{Game, Screenshot}
  alias Gamepedia.Genres.Genre

  @page_size 16

  # ---------------------------------------------------------------------------
  # Import
  # ---------------------------------------------------------------------------

  @doc """
  Import a game by IGDB ID. Fetches from IGDB, saves to DB with screenshots.
  Returns {:error, :already_exists} if the game is already in the database.
  """
  def import_game(igdb_id, client_id, client_secret) do
    if Repo.exists?(from g in Game, where: g.igdb_id == ^igdb_id) do
      {:error, :already_exists}
    else
      with {:ok, data} <- Gamepedia.Igdb.fetch_game(igdb_id, client_id, client_secret) do
        slug = generate_slug(data.name, data.first_release_date, igdb_id)

        Repo.transaction(fn ->
          game =
            %Game{}
            |> Game.changeset(%{
              igdb_id:            data.igdb_id,
              name:               data.name,
              slug:               slug,
              summary:            data.summary,
              cover_image_url:    data.cover_image_url,
              trailer_youtube_id: data.trailer_youtube_id,
              developer:          data.developer,
              publisher:          data.publisher,
              first_release_date: data.first_release_date,
              raw_igdb_data:      data.raw_igdb_data
            })
            |> Repo.insert!()

          save_screenshots(game.id, data.screenshots)
          Repo.preload(game, [:genres, :screenshots])
        end)
      end
    end
  end

  @doc """
  Re-fetch a game from IGDB and update its data. Keeps the existing slug.
  """
  def refresh_game(id, client_id, client_secret) do
    case get_game(id) do
      nil -> {:error, :not_found}
      game ->
        with {:ok, data} <- Gamepedia.Igdb.fetch_game(game.igdb_id, client_id, client_secret) do
          Repo.transaction(fn ->
            game
            |> Game.changeset(%{
              name:               data.name,
              summary:            data.summary,
              cover_image_url:    data.cover_image_url,
              trailer_youtube_id: data.trailer_youtube_id,
              developer:          data.developer,
              publisher:          data.publisher,
              first_release_date: data.first_release_date,
              raw_igdb_data:      data.raw_igdb_data
            })
            |> Repo.update!()

            # Delete old screenshots and save fresh ones
            Repo.delete_all(from s in Screenshot, where: s.game_id == ^game.id)
            save_screenshots(game.id, data.screenshots)

            Repo.preload(Repo.reload!(game), [:genres, :screenshots])
          end)
        end
    end
  end

  @doc """
  Delete a game and all its associated data (screenshots cascade via FK).
  """
  def delete_game(id) do
    case get_game(id) do
      nil  -> {:error, :not_found}
      game -> Repo.delete(game)
    end
  end

  # ---------------------------------------------------------------------------
  # Queries
  # ---------------------------------------------------------------------------

  def get_game(id), do: Repo.get(Game, id)

  def get_game_by_slug(slug) do
    Game
    |> Repo.get_by(slug: slug)
    |> case do
      nil  -> nil
      game -> Repo.preload(game, [:genres, :screenshots])
    end
  end

  @doc """
  Paginated game list with optional search, genre, year, and sort filters.
  """
  def list_games(params \\ %{}) do
    search = Map.get(params, "search", "") |> String.trim()
    genre  = Map.get(params, "genre",  "") |> String.trim()
    year   = Map.get(params, "year",   "") |> String.trim()
    sort   = Map.get(params, "sort",   "newest")
    page   = max(1, String.to_integer(to_string(Map.get(params, "page", "1"))))

    query =
      from g in Game,
        preload: [:genres]

    query = apply_sort(query, sort)
    query = if search != "", do: where(query, [g], ilike(g.name, ^"%#{search}%")), else: query
    query = if genre  != "", do: filter_by_genre(query, genre), else: query
    query = if year   != "", do: filter_by_year(query, year),   else: query

    total = Repo.aggregate(query, :count, :id)
    games = query |> offset(^((page - 1) * @page_size)) |> limit(^@page_size) |> Repo.all()

    %{
      games:   games,
      total:   total,
      page:    page,
      pages:   ceil(total / @page_size),
      has_more: (page * @page_size) < total
    }
  end

  @doc """
  Available genres and release years for filter dropdowns.
  """
  def filter_options do
    genres =
      from(g in Genre, order_by: [asc: g.name])
      |> Repo.all()
      |> Enum.map(&%{id: &1.id, name: &1.name, slug: &1.slug})

    years =
      from(g in Game,
        where: not is_nil(g.first_release_date),
        select: fragment("EXTRACT(YEAR FROM to_timestamp(?))::int", g.first_release_date),
        distinct: true,
        order_by: [desc: fragment("EXTRACT(YEAR FROM to_timestamp(?))::int", g.first_release_date)]
      )
      |> Repo.all()

    %{genres: genres, years: years}
  end

  # ---------------------------------------------------------------------------
  # Genre assignment
  # ---------------------------------------------------------------------------

  def update_game_genres(game_id, genre_ids) when is_list(genre_ids) do
    case get_game(game_id) do
      nil -> {:error, :not_found}
      game ->
        genres = Repo.all(from g in Genre, where: g.id in ^genre_ids)
        game
        |> Repo.preload(:genres)
        |> Ecto.Changeset.change()
        |> Ecto.Changeset.put_assoc(:genres, genres)
        |> Repo.update()
    end
  end

  # ---------------------------------------------------------------------------
  # Private helpers
  # ---------------------------------------------------------------------------

  defp save_screenshots(game_id, screenshots) do
    for {s, idx} <- Enum.with_index(screenshots) do
      %Screenshot{}
      |> Screenshot.changeset(%{
        game_id:       game_id,
        igdb_image_id: s.igdb_image_id,
        url:           s.url,
        order:         Map.get(s, :order, idx)
      })
      |> Repo.insert!()
    end
  end

  defp apply_sort(query, "az"),     do: order_by(query, [g], asc:  g.name)
  defp apply_sort(query, "za"),     do: order_by(query, [g], desc: g.name)
  defp apply_sort(query, "oldest"), do: order_by(query, [g], asc:  g.inserted_at)
  defp apply_sort(query, _),        do: order_by(query, [g], desc: g.inserted_at)

  defp filter_by_genre(query, genre_slug) do
    from g in query,
      join: gg in "gamepedia_game_genre", on: gg.game_id == g.id,
      join: genre in Genre, on: genre.id == gg.genre_id,
      where: genre.slug == ^genre_slug
  end

  defp filter_by_year(query, year_str) do
    case Integer.parse(year_str) do
      {year, ""} ->
        start_ts = DateTime.new!(Date.new!(year, 1,  1),  ~T[00:00:00], "Etc/UTC") |> DateTime.to_unix()
        end_ts   = DateTime.new!(Date.new!(year, 12, 31), ~T[23:59:59], "Etc/UTC") |> DateTime.to_unix()
        where(query, [g], g.first_release_date >= ^start_ts and g.first_release_date <= ^end_ts)
      _ ->
        query
    end
  end

  defp generate_slug(name, release_ts, igdb_id) do
    base = name |> String.downcase() |> String.replace(~r/[^a-z0-9]+/, "-") |> String.trim("-")

    cond do
      not Repo.exists?(from g in Game, where: g.slug == ^base) ->
        base

      release_ts ->
        year      = release_ts |> DateTime.from_unix!() |> Map.get(:year)
        with_year = "#{base}-#{year}"
        if not Repo.exists?(from g in Game, where: g.slug == ^with_year) do
          with_year
        else
          "#{base}-#{igdb_id}"
        end

      true ->
        "#{base}-#{igdb_id}"
    end
  end
end
