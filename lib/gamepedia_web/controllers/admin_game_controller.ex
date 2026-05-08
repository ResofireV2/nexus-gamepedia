defmodule GamepediaWeb.AdminGameController do
  use Phoenix.Controller, formats: [:json]

  alias Gamepedia.Games
  alias GamepediaWeb.GameController

  # ---------------------------------------------------------------------------
  # POST /api/admin/games/import
  # Body: {igdb_id, client_id, client_secret}
  # ---------------------------------------------------------------------------

  def import(conn, %{"igdb_id" => igdb_id, "client_id" => cid, "client_secret" => cs}) do
    id = parse_int(igdb_id)

    case Games.import_game(id, cid, cs) do
      {:ok, game} ->
        conn |> put_status(:created) |> json(%{data: GameController.game_summary(game)})

      {:error, :already_exists} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "This game has already been imported"})

      {:error, :not_found} ->
        conn |> put_status(:not_found) |> json(%{error: "Game not found on IGDB"})

      {:error, reason} when is_binary(reason) ->
        conn |> put_status(:bad_gateway) |> json(%{error: reason})

      {:error, changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: format_errors(changeset)})
    end
  end

  def import(conn, _params) do
    conn |> put_status(:bad_request) |> json(%{error: "Required: igdb_id, client_id, client_secret"})
  end

  # ---------------------------------------------------------------------------
  # POST /api/admin/games/:id/refresh
  # Body: {client_id, client_secret}
  # ---------------------------------------------------------------------------

  def refresh(conn, %{"id" => id, "client_id" => cid, "client_secret" => cs}) do
    case Games.refresh_game(parse_int(id), cid, cs) do
      {:ok, game}              -> json(conn, %{data: GameController.game_summary(game)})
      {:error, :not_found}     -> conn |> put_status(:not_found) |> json(%{error: "Game not found"})
      {:error, reason} when is_binary(reason) ->
        conn |> put_status(:bad_gateway) |> json(%{error: reason})
    end
  end

  def refresh(conn, _), do:
    conn |> put_status(:bad_request) |> json(%{error: "Required: client_id, client_secret"})

  # ---------------------------------------------------------------------------
  # POST /api/admin/games/:id/genres
  # Body: {genre_ids: [1, 2, 3]}
  # ---------------------------------------------------------------------------

  def update_genres(conn, %{"id" => id, "genre_ids" => genre_ids}) do
    ids = Enum.map(genre_ids, &parse_int/1)

    case Games.update_game_genres(parse_int(id), ids) do
      {:ok, _}             -> json(conn, %{ok: true})
      {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "Game not found"})
      {:error, changeset}  -> conn |> put_status(:unprocessable_entity) |> json(%{error: format_errors(changeset)})
    end
  end

  def update_genres(conn, _), do:
    conn |> put_status(:bad_request) |> json(%{error: "Required: genre_ids (array)"})

  # ---------------------------------------------------------------------------
  # DELETE /api/admin/games/:id
  # ---------------------------------------------------------------------------

  def delete(conn, %{"id" => id}) do
    case Games.delete_game(parse_int(id)) do
      {:ok, _}             -> json(conn, %{ok: true})
      {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "Game not found"})
    end
  end

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  defp parse_int(v) when is_integer(v), do: v
  defp parse_int(v) when is_binary(v) do
    case Integer.parse(v) do
      {i, _} -> i
      :error -> 0
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", to_string(v)) end)
    end)
  end
end
