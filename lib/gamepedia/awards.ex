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

  @doc """
  Awards for several games at once, as `%{game_id => [award]}`. Games with no
  awards are absent from the map; callers should default to `[]`.
  """
  def list_for_games([]), do: %{}

  def list_for_games(game_ids) when is_list(game_ids) do
    from(a in @table,
      where: a.game_id in ^game_ids,
      order_by: [desc: a.year, asc: a.title],
      select: %{id: a.id, game_id: a.game_id, year: a.year, title: a.title}
    )
    |> Repo.all()
    |> Enum.group_by(& &1.game_id)
  end

  # ---------------------------------------------------------------------------
  # Create an award
  # ---------------------------------------------------------------------------

  def create(game_id, year, title) do
    year_str  = to_string(year) |> String.trim()
    title_str = to_string(title) |> String.trim()

    case validate(year_str, title_str) do
      {:error, _} = err ->
        err

      :ok ->
        now = DateTime.utc_now() |> DateTime.truncate(:second)

        # Previously this pattern-matched {1, _} on the insert result, so a
        # zero-row insert raised a MatchError that the rescue turned into a
        # raw Elixir message in the admin UI.
        case Repo.insert_all(@table, [%{
               game_id:     game_id,
               year:        year_str,
               title:       title_str,
               inserted_at: now,
               updated_at:  now,
             }]) do
          {1, _} -> {:ok, :created}
          {0, _} -> {:error, "Could not create award"}
        end
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

    # Shares validate/2 with create/3. Update previously skipped the length
    # checks, so an over-long year or title hit the column size limit and
    # surfaced as a database error instead of a readable message.
    case validate(year_str, title_str) do
      {:error, _} = err ->
        err

      :ok ->
        now = DateTime.utc_now() |> DateTime.truncate(:second)
        {count, _} =
          from(a in @table, where: a.id == ^id)
          |> Repo.update_all(set: [year: year_str, title: title_str, updated_at: now])
        if count > 0, do: {:ok, :updated}, else: {:error, :not_found}
    end
  rescue
    e -> {:error, Exception.message(e)}
  end

  # Column limits are year varchar(4) and title varchar(100); these checks
  # keep the failure a readable message rather than a constraint violation.
  defp validate(year_str, title_str) do
    cond do
      year_str  == ""                -> {:error, "Year is required"}
      title_str == ""                -> {:error, "Title is required"}
      String.length(year_str)  > 4   -> {:error, "Year must be 4 characters or fewer"}
      String.length(title_str) > 100 -> {:error, "Title must be 100 characters or fewer"}
      true                           -> :ok
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
