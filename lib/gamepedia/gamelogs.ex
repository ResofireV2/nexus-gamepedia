defmodule Gamepedia.Gamelogs do
  @moduledoc """
  Context for gamelog operations — add, remove, toggle playing, list.

  Each gamelog row stores `user_id` (the Nexus user id, resolved from
  `conn.assigns.current_user` by the controller) and `game_id`. Joins against
  Nexus tables are done by string table name (e.g. `"users"`) rather than by
  aliasing the schema, per the extension guide §8.10 — keeps the extension
  decoupled from Nexus's internal schema modules.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Gamepedia.Games.Game

  @table "gamepedia_gamelogs"

  # ---------------------------------------------------------------------------
  # Add a game to a user's gamelog
  # ---------------------------------------------------------------------------

  def add(user_id, game_id) do
    unless Repo.get(Game, game_id) do
      {:error, :not_found}
    else
      now = DateTime.utc_now() |> DateTime.truncate(:second)

      case Repo.insert_all(
             @table,
             [%{user_id: user_id, game_id: game_id, is_playing: false, inserted_at: now}],
             on_conflict: :nothing,
             conflict_target: [:user_id, :game_id]
           ) do
        {1, _} -> {:ok, :added}
        {0, _} -> {:ok, :already_added}
      end
    end
  rescue
    e -> {:error, Exception.message(e)}
  end

  # ---------------------------------------------------------------------------
  # Remove a game from a user's gamelog
  # ---------------------------------------------------------------------------

  def remove(user_id, game_id) do
    {count, _} =
      from(g in @table, where: g.user_id == ^user_id and g.game_id == ^game_id)
      |> Repo.delete_all()

    if count > 0, do: {:ok, :removed}, else: {:error, :not_found}
  end

  # ---------------------------------------------------------------------------
  # Toggle currently playing
  # ---------------------------------------------------------------------------

  def toggle_playing(user_id, game_id) do
    entry =
      from(g in @table,
        where: g.user_id == ^user_id and g.game_id == ^game_id,
        select: %{is_playing: g.is_playing}
      )
      |> Repo.one()

    case entry do
      nil ->
        {:error, :not_found}

      entry ->
        now_playing = !entry.is_playing

        from(g in @table, where: g.user_id == ^user_id)
        |> Repo.update_all(set: [is_playing: false])

        if now_playing do
          from(g in @table, where: g.user_id == ^user_id and g.game_id == ^game_id)
          |> Repo.update_all(set: [is_playing: true])
        end

        {:ok, now_playing}
    end
  end

  # ---------------------------------------------------------------------------
  # List a user's gamelog by user_id (paginated, filterable, sortable).
  # user_id is the canonical Nexus user id, resolved from conn.assigns.current_user
  # by the caller — no cross-database join against Nexus's users table is done here.
  # ---------------------------------------------------------------------------

  def list(user_id, params \\ %{}) do
    page   = max(1, parse_int(params["page"] || 1))
    sort   = params["sort"] || "newest"
    genre  = params["genre"] || ""
    search = params["search"] || ""
    limit  = 16

    base =
      from(g in Game,
        join: gl in @table, on: gl.game_id == g.id,
        where: gl.user_id == ^user_id,
        select: %{
          id:                 g.id,
          name:               g.name,
          slug:               g.slug,
          cover_image_url:    g.cover_image_url,
          first_release_date: g.first_release_date,
          developer:          g.developer,
          is_playing:         gl.is_playing,
          inserted_at:        gl.inserted_at
        }
      )

    base = apply_search(base, search)
    base = apply_genre_filter(base, genre)
    base = apply_sort(base, sort)

    total  = Repo.aggregate(base, :count)
    games  = base |> offset((^page - 1) * ^limit) |> limit(^limit) |> Repo.all()
    genres = list_user_genres(user_id)

    {games, total, genres, page, limit}
  end

  # ---------------------------------------------------------------------------
  # Stats for a user's gamelog
  # ---------------------------------------------------------------------------

  def stats(user_id) do
    # Each figure below is its own aggregate. The previous version loaded the
    # user's entire gamelog into memory with Repo.all/1 and reduced in Elixir
    # to produce four numbers — so a member with a few thousand games pulled
    # every row on each profile-tab view.
    month_ago = DateTime.utc_now() |> DateTime.add(-30, :day) |> DateTime.truncate(:second)

    total =
      from(gl in @table, where: gl.user_id == ^user_id)
      |> Repo.aggregate(:count)

    added_this_month =
      from(gl in @table,
        where: gl.user_id == ^user_id and gl.inserted_at >= ^month_ago
      )
      |> Repo.aggregate(:count)

    playing =
      from(g in Game,
        join: gl in @table, on: gl.game_id == g.id,
        where: gl.user_id == ^user_id and gl.is_playing == true,
        limit: 1,
        select: %{
          id:                 g.id,
          name:               g.name,
          slug:               g.slug,
          cover_image_url:    g.cover_image_url,
          first_release_date: g.first_release_date
        }
      )
      |> Repo.one()

    oldest =
      from(g in Game,
        join: gl in @table, on: gl.game_id == g.id,
        where: gl.user_id == ^user_id and not is_nil(g.first_release_date),
        order_by: [asc: g.first_release_date],
        limit: 1,
        select: %{name: g.name, first_release_date: g.first_release_date}
      )
      |> Repo.one()

    top_genre =
      from(g in "gamepedia_genres",
        join: gg in "gamepedia_game_genre", on: gg.genre_id == g.id,
        join: gl in @table,                 on: gl.game_id == gg.game_id,
        where: gl.user_id == ^user_id,
        group_by: [g.id, g.name],
        order_by: [desc: count(g.id)],
        limit: 1,
        select: %{name: g.name, count: count(g.id)}
      )
      |> Repo.one()

    %{
      total:            total,
      added_this_month: added_this_month,
      # slug and cover_image_url are included so the Now Playing widget can
      # render and link to the game directly from stats. It previously read
      # page one of the gamelog listing and scanned for is_playing, which
      # missed the game entirely once a user's log grew past 16 entries.
      playing:          playing && %{
        id:              playing.id,
        name:            playing.name,
        slug:            playing.slug,
        cover_image_url: playing.cover_image_url,
        release_year:    release_year(playing.first_release_date)
      },
      top_genre: top_genre,
      oldest:    oldest && %{name: oldest.name, year: release_year(oldest.first_release_date)}
    }
  end

  @doc """
  Returns `%{game_id => is_playing}` for whichever of `game_ids` are in
  `user_id`'s gamelog. Absence from the map means the game is not logged.

  Carries is_playing as well as membership because callers that show an
  "in gamelog" control generally also need to label it correctly.

  Callers that need to show an in-gamelog indicator for a handful of games
  previously fetched page one of the user's full gamelog and tested
  membership against it. That was both wasteful and wrong: the listing is
  paginated at 16, so any game outside the first page reported as not-added.
  """
  def log_state_for_games(_user_id, []), do: %{}

  def log_state_for_games(user_id, game_ids) when is_list(game_ids) do
    from(gl in @table,
      where: gl.user_id == ^user_id and gl.game_id in ^game_ids,
      select: {gl.game_id, gl.is_playing}
    )
    |> Repo.all()
    |> Map.new()
  end

  # ---------------------------------------------------------------------------
  # Private helpers
  # ---------------------------------------------------------------------------

  defp apply_search(q, ""), do: q
  defp apply_search(q, s),  do: where(q, [g], ilike(g.name, ^"%#{s}%"))

  defp apply_genre_filter(q, ""), do: q
  defp apply_genre_filter(q, genre) do
    from(g in q,
      join: gg in "gamepedia_game_genre", on: gg.game_id == g.id,
      join: gen in "gamepedia_genres",    on: gen.id == gg.genre_id,
      where: gen.slug == ^genre
    )
  end

  defp apply_sort(q, "az"),   do: order_by(q, [g], asc: g.name)
  defp apply_sort(q, "year"), do: order_by(q, [g], desc: g.first_release_date)
  defp apply_sort(q, _),      do: order_by(q, [g, gl], desc: gl.inserted_at)

  defp list_user_genres(user_id) do
    from(g in "gamepedia_genres",
      join: gg in "gamepedia_game_genre", on: gg.genre_id == g.id,
      join: gl in @table,                 on: gl.game_id == gg.game_id,
      where: gl.user_id == ^user_id,
      distinct: true,
      order_by: g.name,
      select: %{id: g.id, name: g.name, slug: g.slug}
    )
    |> Repo.all()
  end

  defp release_year(nil), do: nil
  defp release_year(ts),  do: ts |> DateTime.from_unix!() |> Map.get(:year)

  defp parse_int(v) when is_integer(v), do: v
  defp parse_int(v) when is_binary(v) do
    case Integer.parse(v) do
      {i, _} -> i
      :error -> 1
    end
  end
  defp parse_int(_), do: 1
end
