defmodule Gamepedia.PostGames do
  @moduledoc """
  Context for linking games to forum posts.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Gamepedia.Games.Game

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
  end

  # ---------------------------------------------------------------------------
  # Delete all game links for a post (called on post_deleted webhook)
  # ---------------------------------------------------------------------------

  # List post IDs linked to a game
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

  def delete_links_for_post(post_id) do
    from(pg in @post_game_table, where: pg.post_id == ^post_id)
    |> Repo.delete_all()

    :ok
  end
end
