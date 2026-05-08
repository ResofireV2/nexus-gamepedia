defmodule GamepediaWeb.GamelogController do
  @moduledoc """
  POST   /api/gamelog                    — add game to current user's gamelog
  DELETE /api/gamelog/:game_id           — remove from gamelog
  POST   /api/gamelog/:game_id/playing   — toggle currently playing
  GET    /api/gamelog/:username          — view a user's gamelog
  """

  use Phoenix.Controller, formats: [:json]

  alias Gamepedia.Gamelogs

  # ---------------------------------------------------------------------------
  # POST /api/gamelog
  # Body: { game_id, user_id }
  # user_id is passed from the Nexus frontend (the logged-in user's id)
  # ---------------------------------------------------------------------------

  def add(conn, %{"game_id" => game_id, "user_id" => user_id}) do
    case Gamelogs.add(parse_int(user_id), parse_int(game_id)) do
      {:ok, :added}        -> conn |> put_status(:created) |> json(%{ok: true})
      {:ok, :already_added}-> json(conn, %{ok: true, already_added: true})
      {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "Game not found"})
      {:error, reason}     -> conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
    end
  end

  def add(conn, _),
    do: conn |> put_status(:bad_request) |> json(%{error: "Required: game_id, user_id"})

  # ---------------------------------------------------------------------------
  # DELETE /api/gamelog/:game_id
  # ---------------------------------------------------------------------------

  def remove(conn, %{"game_id" => game_id, "user_id" => user_id}) do
    case Gamelogs.remove(parse_int(user_id), parse_int(game_id)) do
      {:ok, :removed}      -> json(conn, %{ok: true})
      {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "Not in gamelog"})
    end
  end

  def remove(conn, _),
    do: conn |> put_status(:bad_request) |> json(%{error: "Required: user_id"})

  # ---------------------------------------------------------------------------
  # POST /api/gamelog/:game_id/playing
  # ---------------------------------------------------------------------------

  def toggle_playing(conn, %{"game_id" => game_id, "user_id" => user_id}) do
    case Gamelogs.toggle_playing(parse_int(user_id), parse_int(game_id)) do
      {:ok, is_playing}    -> json(conn, %{ok: true, is_playing: is_playing})
      {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "Not in gamelog"})
    end
  end

  def toggle_playing(conn, _),
    do: conn |> put_status(:bad_request) |> json(%{error: "Required: user_id"})

  # ---------------------------------------------------------------------------
  # GET /api/gamelog/:username
  # ---------------------------------------------------------------------------

  def index(conn, %{"username" => username} = params) do
    case Gamelogs.list(username, params) do
      {games, total, nil, _, _, _} ->
        conn |> put_status(:not_found) |> json(%{error: "User not found"})

      {games, total, user, genres, page, limit} ->
        # Compute stats on page 1
        stats = if page == 1, do: Gamelogs.stats(user.id), else: nil

        json(conn, %{
          data: Enum.map(games, &game_json/1),
          meta: %{
            total:        total,
            per_page:     limit,
            current_page: page,
            last_page:    ceil(total / limit)
          },
          filters:  %{genres: genres},
          user:     %{id: user.id, username: user.username},
          is_owner: false,  # ownership checked client-side via current user id
          stats:    stats,
        })
    end
  end

  # ---------------------------------------------------------------------------
  # Private
  # ---------------------------------------------------------------------------

  defp game_json(g) do
    %{
      id:              g.id,
      name:            g.name,
      slug:            g.slug,
      cover_image_url: g.cover_image_url,
      release_year:    release_year(g.first_release_date),
      is_playing:      g.is_playing,
      added_at:        g.inserted_at && Calendar.strftime(g.inserted_at, "%m/%d/%Y")
    }
  end

  defp release_year(nil), do: nil
  defp release_year(ts),  do: ts |> DateTime.from_unix!() |> Map.get(:year)

  defp parse_int(v) when is_integer(v), do: v
  defp parse_int(v) when is_binary(v) do
    case Integer.parse(v) do
      {i, _} -> i
      :error -> 0
    end
  end
end
