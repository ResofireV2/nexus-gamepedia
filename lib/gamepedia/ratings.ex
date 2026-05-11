defmodule Gamepedia.Ratings do
  @moduledoc """
  Context for game ratings — 1–10 integer scale.

  Ratings are per-user, per-game. Users may update their rating at any time;
  the table has a unique index on (user_id, game_id).
  """

  import Ecto.Query
  alias Nexus.Repo

  @table "gamepedia_ratings"

  # ---------------------------------------------------------------------------
  # Upsert a rating (1–10)
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
    rows =
      from(r in @table,
        where: r.game_id == ^game_id,
        select: r.rating
      )
      |> Repo.all()

    count = length(rows)
    avg   = if count > 0, do: Float.round(Enum.sum(rows) / count, 1), else: nil

    distribution =
      Enum.reduce(1..5, %{}, fn n, acc -> Map.put(acc, n, 0) end)
      |> then(fn base -> Enum.reduce(rows, base, fn r, acc -> Map.update(acc, r, 1, &(&1 + 1)) end) end)
      |> Enum.map(fn {score, cnt} -> %{score: score, count: cnt} end)
      |> Enum.sort_by(& &1.score)

    %{count: count, avg: avg, distribution: distribution}
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
  # Bulk-fetch user ratings for multiple games (used in gamelog page)
  # Returns %{game_id => rating}
  # ---------------------------------------------------------------------------

  def user_ratings_for_games(user_id, game_ids) when is_list(game_ids) do
    from(r in @table,
      where: r.user_id == ^user_id and r.game_id in ^game_ids,
      select: {r.game_id, r.rating}
    )
    |> Repo.all()
    |> Map.new()
  end
end
