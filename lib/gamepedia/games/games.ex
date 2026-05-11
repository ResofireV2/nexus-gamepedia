defmodule Gamepedia.Games do
  @moduledoc """
  Games context. Handles all database operations for games and screenshots.
  """

  import Ecto.Query
  alias Nexus.Repo
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

            # Delete old screenshots (files + DB rows) and save fresh ones
            old_screenshots = Repo.all(from s in Screenshot, where: s.game_id == ^game.id)
            Enum.each(old_screenshots, &delete_screenshot_files/1)
            Repo.delete_all(from s in Screenshot, where: s.game_id == ^game.id)
            save_screenshots(game.id, data.screenshots)

            Repo.preload(Repo.reload!(game), [:genres, :screenshots])
          end)
        end
    end
  end

  @doc """
  Delete a game and all its associated data (screenshots cascade via FK).
  Also removes screenshot files from disk.
  """
  def delete_game(id) do
    case get_game(id) do
      nil  -> {:error, :not_found}
      game ->
        screenshots = Repo.all(from s in Screenshot, where: s.game_id == ^game.id)
        Enum.each(screenshots, &delete_screenshot_files/1)
        Repo.delete(game)
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
  # Screenshot storage
  # ---------------------------------------------------------------------------

  # Screenshots are stored via Nexus.Extensions.Storage and served at
  # /ext/gamepedia/assets/screenshots/* — no separate directory config needed.
  @screenshot_subdir "screenshots"

  @doc """
  Public URL for serving a screenshot file.
  e.g. "abc123.webp" -> "/uploads/extensions/gamepedia/screenshots/abc123.webp"
  """
  def screenshot_url(nil), do: nil
  def screenshot_url(rel_path),
    do: Nexus.Extensions.Storage.url("gamepedia", "#{@screenshot_subdir}/#{rel_path}")

  # ---------------------------------------------------------------------------
  # Private helpers
  # ---------------------------------------------------------------------------

  defp save_screenshots(game_id, screenshots) do
    for {s, idx} <- Enum.with_index(screenshots) do
      {local_path, webp_path} = download_and_convert(s.igdb_image_id, s.url)

      %Screenshot{}
      |> Screenshot.changeset(%{
        game_id:       game_id,
        igdb_image_id: s.igdb_image_id,
        url:           s.url,
        local_path:    local_path,
        webp_path:     webp_path,
        order:         Map.get(s, :order, idx)
      })
      |> Repo.insert!()
    end
  end

  # Download the IGDB screenshot at full resolution (t_1080p), save as jpg,
  # then convert to webp. Returns {local_rel_path, webp_rel_path} or {nil, nil}
  # on failure (falls back to the original IGDB URL in the UI).
  defp download_and_convert(image_id, igdb_url) do
    full_url  = String.replace(igdb_url, "t_screenshot_big", "t_1080p")
    filename  = "#{image_id}.jpg"
    webp_name = "#{image_id}.webp"

    :ok      = Nexus.Extensions.Storage.ensure_dir("gamepedia", @screenshot_subdir)
    abs_jpg  = Nexus.Extensions.Storage.path("gamepedia", "#{@screenshot_subdir}/#{filename}")
    abs_webp = Nexus.Extensions.Storage.path("gamepedia", "#{@screenshot_subdir}/#{webp_name}")

    with {:ok, %{status: 200, body: body}} <- Req.get(full_url, receive_timeout: 30_000),
         :ok              <- File.write(abs_jpg, body),
         {:ok, image}     <- Image.open(abs_jpg),
         {:ok, {image, _}} <- Image.autorotate(image),
         {:ok, _}         <- Image.write(image, abs_webp, quality: 85, suffix: ".webp") do
      {filename, webp_name}
    else
      err ->
        require Logger
        Logger.warning("Failed to download/convert screenshot #{image_id}: #{inspect(err)}")
        {nil, nil}
    end
  end

  defp delete_screenshot_files(%Screenshot{local_path: nil, webp_path: nil}), do: :ok
  defp delete_screenshot_files(%Screenshot{local_path: local, webp_path: webp}) do
    if local, do: File.rm(Nexus.Extensions.Storage.path("gamepedia", "#{@screenshot_subdir}/#{local}"))
    if webp,  do: File.rm(Nexus.Extensions.Storage.path("gamepedia", "#{@screenshot_subdir}/#{webp}"))
    :ok
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
