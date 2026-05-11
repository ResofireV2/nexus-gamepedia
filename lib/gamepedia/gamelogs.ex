defmodule Gamepedia.Gamelogs do
  @moduledoc """
  Context for gamelog operations — add, remove, toggle playing, list.

  NOTE: Gamepedia runs in its own database. It has no access to the Nexus
  users table. All user identity comes from the X-Nexus-User-Id header
  that the Nexus proxy injects on every authenticated request.
  Usernames are stored denormalized in the gamelog for display purposes.
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
  # Check if a game is in a user's gamelog
  # ---------------------------------------------------------------------------

  def in_gamelog?(user_id, game_id) do
    from(g in @table, where: g.user_id == ^user_id and g.game_id == ^game_id)
    |> Repo.exists?()
  end

  # ---------------------------------------------------------------------------
  # List a user's gamelog by user_id (paginated, filterable, sortable)
  # No join against Nexus users table — user_id comes from the proxy header.
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
    all =
      from(g in Game,
        join: gl in @table, on: gl.game_id == g.id,
        where: gl.user_id == ^user_id,
        select: %{
          id:                 g.id,
          name:               g.name,
          first_release_date: g.first_release_date,
          is_playing:         gl.is_playing,
          inserted_at:        gl.inserted_at
        }
      )
      |> Repo.all()

    now       = DateTime.utc_now()
    month_ago = DateTime.add(now, -30, :day)
    total     = length(all)

    added_this_month =
      Enum.count(all, fn g ->
        case g.inserted_at do
          nil -> false
          %NaiveDateTime{} = ndt ->
            dt = DateTime.from_naive!(ndt, "Etc/UTC")
            DateTime.compare(dt, month_ago) == :gt
          %DateTime{} = dt ->
            DateTime.compare(dt, month_ago) == :gt
        end
      end)

    playing   = Enum.find(all, & &1.is_playing)
    with_date = Enum.filter(all, & &1.first_release_date)
    oldest    = Enum.min_by(with_date, & &1.first_release_date, fn -> nil end)

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
      playing:          playing && %{
        id:           playing.id,
        name:         playing.name,
        release_year: release_year(playing.first_release_date)
      },
      top_genre: top_genre,
      oldest:    oldest && %{name: oldest.name, year: release_year(oldest.first_release_date)}
    }
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
