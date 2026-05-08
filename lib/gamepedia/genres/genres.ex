defmodule Gamepedia.Genres do
  @moduledoc "Genres context. Handles all genre database operations."

  import Ecto.Query
  alias Gamepedia.Repo
  alias Gamepedia.Genres.Genre

  def list_genres do
    from(g in Genre,
      order_by: [asc: g.name],
      left_join: gg in "gamepedia_game_genre", on: gg.genre_id == g.id,
      group_by: g.id,
      select: %{id: g.id, name: g.name, slug: g.slug, igdb_id: g.igdb_id,
                game_count: count(gg.game_id)}
    )
    |> Repo.all()
  end

  def get_genre(id), do: Repo.get(Genre, id)

  def create_genre(name) when is_binary(name) do
    slug = slugify(name)

    %Genre{}
    |> Genre.changeset(%{name: String.trim(name), slug: slug})
    |> Repo.insert()
  end

  def update_genre(id, name) when is_binary(name) do
    case get_genre(id) do
      nil -> {:error, :not_found}
      genre ->
        genre
        |> Genre.changeset(%{name: String.trim(name), slug: slugify(name)})
        |> Repo.update()
    end
  end

  def delete_genre(id) do
    case get_genre(id) do
      nil -> {:error, :not_found}
      genre ->
        # Remove all game associations first, then delete
        Repo.delete_all(from gg in "gamepedia_game_genre", where: gg.genre_id == ^genre.id)
        Repo.delete(genre)
    end
  end

  defp slugify(name) do
    name |> String.downcase() |> String.replace(~r/[^a-z0-9]+/, "-") |> String.trim("-")
  end
end
