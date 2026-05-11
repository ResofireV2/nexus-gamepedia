defmodule Gamepedia.GenreController do
  use Phoenix.Controller, formats: [:json]
  import Gamepedia.ControllerHelpers
  alias Gamepedia.Genres

  def index(conn, _), do: json(conn, %{data: Enum.map(Genres.list_genres(), &genre_map/1)})

  def create(conn, %{"name" => name}) do
    case Genres.create_genre(name) do
      {:ok, genre}    -> conn |> put_status(:created) |> json(%{data: genre_map(genre)})
      {:error, cs}    -> conn |> put_status(:unprocessable_entity) |> json(%{error: format_errors(cs)})
    end
  end
  def create(conn, _), do: conn |> put_status(:bad_request) |> json(%{error: "Required: name"})

  def update(conn, %{"id" => id, "name" => name}) do
    case Genres.update_genre(parse_int(id), name) do
      {:ok, genre}         -> json(conn, %{data: genre_map(genre)})
      {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "Genre not found"})
      {:error, cs}         -> conn |> put_status(:unprocessable_entity) |> json(%{error: format_errors(cs)})
    end
  end

  def delete(conn, %{"id" => id}) do
    case Genres.delete_genre(parse_int(id)) do
      {:ok, _}             -> json(conn, %{ok: true})
      {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "Genre not found"})
    end
  end

  defp genre_map(g), do: %{id: g.id, name: g.name, slug: g.slug}
end
