defmodule Gamepedia.Awards do
  @moduledoc """
  Context for game awards — admin-curated accolades attached to games.
  e.g. "Game of the Year 2023", "Best Art Direction 2022".
  """

  import Ecto.Query
  alias Nexus.Repo

  @table "gamepedia_awards"

  # ---------------------------------------------------------------------------
  # List awards for a game
  # ---------------------------------------------------------------------------

  def list_for_game(game_id) do
    from(a in @table,
      where: a.game_id == ^game_id,
      order_by: [desc: a.year, asc: a.title],
      select: %{id: a.id, game_id: a.game_id, year: a.year, title: a.title}
    )
    |> Repo.all()
  end

  # ---------------------------------------------------------------------------
  # Create an award
  # ---------------------------------------------------------------------------

  def create(game_id, year, title) do
    year_str  = to_string(year) |> String.trim()
    title_str = to_string(title) |> String.trim()

    cond do
      year_str  == "" -> {:error, "Year is required"}
      title_str == "" -> {:error, "Title is required"}
      String.length(year_str)  > 4   -> {:error, "Year must be 4 characters or fewer"}
      String.length(title_str) > 100 -> {:error, "Title must be 100 characters or fewer"}
      true ->
        now = DateTime.utc_now() |> DateTime.truncate(:second)
        {1, _} =
          Repo.insert_all(@table, [%{
            game_id:     game_id,
            year:        year_str,
            title:       title_str,
            inserted_at: now,
            updated_at:  now,
          }])
        {:ok, :created}
    end
  rescue
    e -> {:error, Exception.message(e)}
  end

  # ---------------------------------------------------------------------------
  # Update an award
  # ---------------------------------------------------------------------------

  def update(id, year, title) do
    year_str  = to_string(year)  |> String.trim()
    title_str = to_string(title) |> String.trim()

    cond do
      year_str  == "" -> {:error, "Year is required"}
      title_str == "" -> {:error, "Title is required"}
      true ->
        now = DateTime.utc_now() |> DateTime.truncate(:second)
        {count, _} =
          from(a in @table, where: a.id == ^id)
          |> Repo.update_all(set: [year: year_str, title: title_str, updated_at: now])
        if count > 0, do: {:ok, :updated}, else: {:error, :not_found}
    end
  end

  # ---------------------------------------------------------------------------
  # Delete an award
  # ---------------------------------------------------------------------------

  def delete(id) do
    {count, _} = from(a in @table, where: a.id == ^id) |> Repo.delete_all()
    if count > 0, do: {:ok, :deleted}, else: {:error, :not_found}
  end
end
