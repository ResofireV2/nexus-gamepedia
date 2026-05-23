defmodule Gamepedia.GamelogController do
  use Phoenix.Controller, formats: [:json]
  import Gamepedia.ControllerHelpers
  alias Gamepedia.Gamelogs

  # ---------------------------------------------------------------------------
  # Write actions — all require an authenticated user; act on the viewer's own
  # gamelog. user_id comes from conn.assigns.current_user (set by LoadUser).
  # ---------------------------------------------------------------------------

  def add(conn, %{"game_id" => game_id}) do
    user_id = nexus_user_id(conn)
    if user_id == 0 do
      conn |> put_status(:unauthorized) |> json(%{error: "Not authenticated"})
    else
      case Gamelogs.add(user_id, parse_int(game_id)) do
        {:ok, :added}         -> conn |> put_status(:created) |> json(%{ok: true})
        {:ok, :already_added} -> json(conn, %{ok: true, already_added: true})
        {:error, :not_found}  -> conn |> put_status(:not_found) |> json(%{error: "Game not found"})
        {:error, reason}      -> conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
      end
    end
  end

  def add(conn, _), do: conn |> put_status(:bad_request) |> json(%{error: "Required: game_id"})

  def remove(conn, %{"game_id" => game_id}) do
    user_id = nexus_user_id(conn)
    if user_id == 0 do
      conn |> put_status(:unauthorized) |> json(%{error: "Not authenticated"})
    else
      case Gamelogs.remove(user_id, parse_int(game_id)) do
        {:ok, :removed}      -> json(conn, %{ok: true})
        {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "Not in gamelog"})
      end
    end
  end

  def toggle_playing(conn, %{"game_id" => game_id}) do
    user_id = nexus_user_id(conn)
    if user_id == 0 do
      conn |> put_status(:unauthorized) |> json(%{error: "Not authenticated"})
    else
      case Gamelogs.toggle_playing(user_id, parse_int(game_id)) do
        {:ok, is_playing}    -> json(conn, %{ok: true, is_playing: is_playing})
        {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "Not in gamelog"})
      end
    end
  end

  # ---------------------------------------------------------------------------
  # Read actions — list someone's gamelog.
  #
  # Two index paths exist for the two contexts that naturally identify users
  # differently:
  #
  #   index_by_user_id/2     — `GET /gamelog/:user_id`
  #                            called from contexts that already have a numeric
  #                            user id (e.g. the linked-games widget on a post
  #                            page, where currentUser.id is in hand).
  #
  #   index_by_username/2    — `GET /users/:username/gamelog`
  #                            called from the profile tab, which receives a
  #                            username string per the profile_tab contract.
  #
  # Both share `respond_with_listing/4` so the response shape is identical.
  # ---------------------------------------------------------------------------

  def index_by_user_id(conn, %{"user_id" => user_id_str} = params) do
    user_id = parse_int(user_id_str)
    if user_id == 0 do
      conn |> put_status(:bad_request) |> json(%{error: "Invalid user_id"})
    else
      respond_with_listing(conn, user_id, nil, params)
    end
  end

  def index_by_username(conn, %{"username" => username} = params) do
    case Nexus.Accounts.get_user_by_username(username) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "User not found"})

      user ->
        respond_with_listing(conn, user.id, username, params)
    end
  end

  defp respond_with_listing(conn, user_id, username, params) do
    {games, total, genres, page, limit} = Gamelogs.list(user_id, params)
    viewer_id = nexus_user_id(conn)
    stats     = if page == 1, do: Gamelogs.stats(user_id), else: nil

    json(conn, %{
      data:     Enum.map(games, &game_json/1),
      meta:     %{total: total, per_page: limit, current_page: page, last_page: max(1, ceil(total / limit))},
      filters:  %{genres: genres},
      user_id:  user_id,
      username: username,
      is_owner: viewer_id == user_id,
      stats:    stats,
    })
  end

  defp game_json(g) do
    %{
      id:              g.id,
      name:            g.name,
      slug:            g.slug,
      cover_image_url: g.cover_image_url,
      release_year:    release_year(g.first_release_date),
      is_playing:      g.is_playing,
      added_at:        g.inserted_at && Calendar.strftime(g.inserted_at, "%m/%d/%Y"),
    }
  end
end
