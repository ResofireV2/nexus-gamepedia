defmodule GamepediaWeb.GenreController do
  use Phoenix.Controller, formats: [:json]

  alias Gamepedia.Genres

  # GET /api/admin/genres
  def index(conn, _params) do
    json(conn, %{data: Enum.map(Genres.list_genres(), &genre_map/1)})
  end

  # POST /api/admin/genres
  def create(conn, %{"name" => name}) do
    case Genres.create_genre(name) do
      {:ok, genre} ->
        conn |> put_status(:created) |> json(%{data: genre_map(genre)})
      {:error, changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: format_errors(changeset)})
    end
  end

  def create(conn, _),
    do: conn |> put_status(:bad_request) |> json(%{error: "Required: name"})

  # PATCH /api/admin/genres/:id
  def update(conn, %{"id" => id, "name" => name}) do
    case Genres.update_genre(String.to_integer(id), name) do
      {:ok, genre}         -> json(conn, %{data: genre_map(genre)})
      {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "Genre not found"})
      {:error, changeset}  -> conn |> put_status(:unprocessable_entity) |> json(%{error: format_errors(changeset)})
    end
  end

  # DELETE /api/admin/genres/:id
  def delete(conn, %{"id" => id}) do
    case Genres.delete_genre(String.to_integer(id)) do
      {:ok, _}             -> json(conn, %{ok: true})
      {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "Genre not found"})
    end
  end

  defp genre_map(g), do: %{id: g.id, name: g.name, slug: g.slug}

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", to_string(v)) end)
    end)
  end
end
