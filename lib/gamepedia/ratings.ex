defmodule Gamepedia.Ratings do
  @moduledoc """
  Context for game ratings — 1–5 integer scale.

  Ratings are per-user, per-game. Users may update their rating at any time;
  the table has a unique index on (user_id, game_id).
  """

  import Ecto.Query
  alias Nexus.Repo

  @table "gamepedia_ratings"

  # ---------------------------------------------------------------------------
  # Upsert a rating (1–5)
  # ---------------------------------------------------------------------------

  def rate(user_id, game_id, rating)
      when is_integer(rating) and rating >= 1 and rating <= 5 do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    {_count, _} =
      Repo.insert_all(
        @table,
        [%{user_id: user_id, game_id: game_id, rating: rating, inserted_at: now}],
        on_conflict:    [set: [rating: rating, inserted_at: now]],
        conflict_target: [:user_id, :game_id]
      )

    {:ok, rating}
  rescue
    e -> {:error, Exception.message(e)}
  end

  def rate(_user_id, _game_id, _rating), do: {:error, :invalid_rating}

  # ---------------------------------------------------------------------------
  # Delete a user's rating for a game
  # ---------------------------------------------------------------------------

  def delete_rating(user_id, game_id) do
    {count, _} =
      from(r in @table, where: r.user_id == ^user_id and r.game_id == ^game_id)
      |> Repo.delete_all()

    if count > 0, do: {:ok, :deleted}, else: {:error, :not_found}
  end

  # ---------------------------------------------------------------------------
  # Summary for a game — avg, count, distribution
  # ---------------------------------------------------------------------------

  def summary(game_id) do
    # One GROUP BY instead of loading every rating row into memory. The old
    # version did Repo.all/1 on all ratings for the game and reduced in
    # Elixir, which meant a popular game pulled thousands of rows on every
    # game-page view and on every rate action.
    counts =
      from(r in @table,
        where: r.game_id == ^game_id,
        group_by: r.rating,
        select: {r.rating, count(r.id)}
      )
      |> Repo.all()
      |> Map.new()

    build_summary(counts)
  end

  @doc """
  Rating summaries for several games at once, returned as
  `%{game_id => summary}`. Games with no ratings are present with a zeroed
  summary so callers can index without a fallback.

  Exists so list views (linked games on a post, browse pages) can render
  ratings with one query instead of one per game.
  """
  def summaries_for_games([]), do: %{}

  def summaries_for_games(game_ids) when is_list(game_ids) do
    grouped =
      from(r in @table,
        where: r.game_id in ^game_ids,
        group_by: [r.game_id, r.rating],
        select: {r.game_id, r.rating, count(r.id)}
      )
      |> Repo.all()
      |> Enum.group_by(fn {gid, _, _} -> gid end, fn {_, rating, cnt} -> {rating, cnt} end)

    Map.new(game_ids, fn gid ->
      {gid, build_summary(Map.new(grouped[gid] || []))}
    end)
  end

  # Turns a %{score => count} map into the response shape, filling in any
  # score from 1..5 that nobody has used.
  defp build_summary(counts) do
    total = counts |> Map.values() |> Enum.sum()

    avg =
      if total > 0 do
        sum = Enum.reduce(counts, 0, fn {score, cnt}, acc -> acc + score * cnt end)
        Float.round(sum / total, 1)
      end

    distribution =
      Enum.map(1..5, fn score -> %{score: score, count: Map.get(counts, score, 0)} end)

    %{count: total, avg: avg, distribution: distribution}
  end

  # ---------------------------------------------------------------------------
  # User's rating for a game (nil if not rated)
  # ---------------------------------------------------------------------------

  def user_rating(user_id, game_id) do
    from(r in @table,
      where: r.user_id == ^user_id and r.game_id == ^game_id,
      select: r.rating
    )
    |> Repo.one()
  end

  # ---------------------------------------------------------------------------
  # Bulk-fetch a user's own ratings for several games. Returns %{game_id => rating}.
  # ---------------------------------------------------------------------------

  def user_ratings_for_games(_user_id, []), do: %{}

  def user_ratings_for_games(user_id, game_ids) when is_list(game_ids) do
    from(r in @table,
      where: r.user_id == ^user_id and r.game_id in ^game_ids,
      select: {r.game_id, r.rating}
    )
    |> Repo.all()
    |> Map.new()
  end
end
