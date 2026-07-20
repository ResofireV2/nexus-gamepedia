defmodule Gamepedia.PostGames do
  @moduledoc """
  Context for linking games to forum posts.

  Writes go through `link_games/2`, called from
  `Gamepedia.persist_attachment/3` when a user submits a post with
  `{kind: "game_link", data: {game_id: ...}}` attachments produced by the
  toolbar button's `attach()` calls (see manifest `side_data` declaration
  and the extension guide §6.3 / §8.9).

  Reads serve the linked-games widget and the per-game thread list.
  Cleanup on post deletion is handled by `delete_links_for_post/1`, invoked
  from `Gamepedia.handle_event("post_deleted", ...)`.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Gamepedia.Games.Game
  alias Gamepedia.Games.Screenshot

  @post_game_table "gamepedia_post_game"

  # ---------------------------------------------------------------------------
  # Link games to a post
  # ---------------------------------------------------------------------------

  def link_games(_post_id, []), do: :ok

  def link_games(post_id, game_ids) when is_list(game_ids) do
    # Verify all game IDs exist
    valid_ids =
      from(g in Game, where: g.id in ^game_ids, select: g.id)
      |> Repo.all()

    now = DateTime.utc_now() |> DateTime.truncate(:second)

    rows =
      valid_ids
      |> Enum.map(fn gid ->
        %{post_id: post_id, game_id: gid, inserted_at: now}
      end)

    Repo.insert_all(
      @post_game_table,
      rows,
      on_conflict: :nothing,
      conflict_target: [:post_id, :game_id]
    )

    :ok
  rescue
    e -> {:error, Exception.message(e)}
  end

  # ---------------------------------------------------------------------------
  # List games linked to a post
  # ---------------------------------------------------------------------------

  def list_games_for_post(post_id) do
    from(g in Game,
      join: pg in @post_game_table, on: pg.game_id == g.id,
      where: pg.post_id == ^post_id,
      order_by: [asc: g.name]
    )
    |> Repo.all()
    |> Repo.preload([:genres, screenshots: first_screenshot_query()])
  end

  # Returns a query that yields the lowest-ordered screenshot for EACH game.
  #
  # The obvious formulation — `from(s in Screenshot, order_by: :order, limit: 1)`
  # — is wrong. Ecto documents that limit and offset in a preload query apply
  # to the whole result set rather than per association, so that version
  # returned exactly one screenshot across every game on the post: the first
  # game got an image and the rest silently got none.
  #
  # Partitioning by game_id and filtering on row_number is the form Ecto's own
  # docs prescribe for "top N per parent".
  defp first_screenshot_query do
    ranked =
      from s in Screenshot,
        select: %{id: s.id, row_number: over(row_number(), :game_partition)},
        windows: [game_partition: [partition_by: s.game_id, order_by: s.order]]

    from s in Screenshot,
      join: r in subquery(ranked),
      on: r.id == s.id and r.row_number == 1
  end

  # ---------------------------------------------------------------------------
  # List post IDs linked to a game
  # ---------------------------------------------------------------------------

  def list_posts_for_game(game_id) do
    from(pg in @post_game_table,
      where: pg.game_id == ^game_id,
      order_by: [desc: pg.post_id],
      limit: 10,
      select: pg.post_id
    )
    |> Repo.all()
  end

  def thread_count(game_id) do
    from(pg in @post_game_table, where: pg.game_id == ^game_id)
    |> Repo.aggregate(:count)
  end

  @doc """
  Thread counts for several games at once, as `%{game_id => count}`. Games
  with no linked threads are absent; callers should default to 0.
  """
  def thread_counts([]), do: %{}

  def thread_counts(game_ids) when is_list(game_ids) do
    from(pg in @post_game_table,
      where: pg.game_id in ^game_ids,
      group_by: pg.game_id,
      select: {pg.game_id, count(pg.id)}
    )
    |> Repo.all()
    |> Map.new()
  end

  # ---------------------------------------------------------------------------
  # Cascade cleanup — called from handle_event("post_deleted", ...)
  # ---------------------------------------------------------------------------

  def delete_links_for_post(post_id) do
    from(pg in @post_game_table, where: pg.post_id == ^post_id)
    |> Repo.delete_all()

    :ok
  end
end
