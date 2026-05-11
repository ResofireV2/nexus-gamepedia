defmodule Gamepedia.AwardController do
  use Phoenix.Controller, formats: [:json]
  import Gamepedia.ControllerHelpers
  alias Gamepedia.Awards

  defp admin_required(conn, action) do
    case require_admin(conn) do
      :ok                     -> action.(conn)
      {:error, :unauthorized} -> conn |> put_status(:unauthorized) |> json(%{error: "Not authenticated"})
      {:error, :forbidden}    -> conn |> put_status(:forbidden)    |> json(%{error: "Admin access required"})
    end
  end

  # GET /admin/games/:game_id/awards
  def index(conn, %{"game_id" => game_id_str}) do
    admin_required(conn, fn conn ->
      awards = Awards.list_for_game(parse_int(game_id_str))
      json(conn, %{data: awards})
    end)
  end

  # POST /admin/games/:game_id/awards   body: {year, title}
  def create(conn, %{"game_id" => game_id_str, "year" => year, "title" => title}) do
    admin_required(conn, fn conn ->
      case Awards.create(parse_int(game_id_str), year, title) do
        {:ok, :created}  -> conn |> put_status(:created) |> json(%{ok: true})
        {:error, reason} -> conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
      end
    end)
  end

  def create(conn, _),
    do: conn |> put_status(:bad_request) |> json(%{error: "Required: year, title"})

  # PATCH /admin/awards/:id   body: {year, title}
  def update(conn, %{"id" => id_str, "year" => year, "title" => title}) do
    admin_required(conn, fn conn ->
      case Awards.update(parse_int(id_str), year, title) do
        {:ok, :updated}      -> json(conn, %{ok: true})
        {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "Award not found"})
        {:error, reason}     -> conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
      end
    end)
  end

  def update(conn, _),
    do: conn |> put_status(:bad_request) |> json(%{error: "Required: year, title"})

  # DELETE /admin/awards/:id
  def delete(conn, %{"id" => id_str}) do
    admin_required(conn, fn conn ->
      case Awards.delete(parse_int(id_str)) do
        {:ok, :deleted}      -> json(conn, %{ok: true})
        {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "Award not found"})
      end
    end)
  end
end
