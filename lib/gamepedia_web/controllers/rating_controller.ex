defmodule Gamepedia.RatingController do
  use Phoenix.Controller, formats: [:json]
  import Gamepedia.ControllerHelpers
  alias Gamepedia.Ratings

  # POST /games/:game_id/rate  body: {rating: 1-5}
  # DELETE /games/:game_id/rate  — remove user's rating
  def rate(conn, %{"game_id" => game_id_str, "rating" => rating_val}) do
    user_id = nexus_user_id(conn)
    if user_id == 0 do
      conn |> put_status(:unauthorized) |> json(%{error: "Not authenticated"})
    else
      game_id = parse_int(game_id_str)
      rating  = parse_int(rating_val)
      case Ratings.rate(user_id, game_id, rating) do
        {:ok, r}                -> json(conn, %{ok: true, rating: r, summary: Ratings.summary(game_id)})
        {:error, :invalid_rating} -> conn |> put_status(:unprocessable_entity) |> json(%{error: "Rating must be 1–5"})
        {:error, reason}        -> conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
      end
    end
  end

  def rate(conn, _), do: conn |> put_status(:bad_request) |> json(%{error: "Required: rating (1–5)"})

  def delete_rating(conn, %{"game_id" => game_id_str}) do
    user_id = nexus_user_id(conn)
    if user_id == 0 do
      conn |> put_status(:unauthorized) |> json(%{error: "Not authenticated"})
    else
      game_id = parse_int(game_id_str)
      case Ratings.delete_rating(user_id, game_id) do
        {:ok, :deleted}      -> json(conn, %{ok: true, summary: Ratings.summary(game_id)})
        {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "No rating found"})
      end
    end
  end

  # GET /games/:game_id/ratings  — summary + optional viewer's own rating
  def summary(conn, %{"game_id" => game_id_str}) do
    game_id   = parse_int(game_id_str)
    user_id   = nexus_user_id(conn)
    summary   = Ratings.summary(game_id)
    user_rating =
      if user_id > 0, do: Ratings.user_rating(user_id, game_id), else: nil

    json(conn, %{data: Map.put(summary, :user_rating, user_rating)})
  end
end
