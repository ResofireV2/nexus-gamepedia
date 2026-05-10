defmodule GamepediaWeb.GamelogController do
  @moduledoc """
  POST   /api/gamelog                    — add game to current user's gamelog
  DELETE /api/gamelog/:game_id           — remove from gamelog
  POST   /api/gamelog/:game_id/playing   — toggle currently playing
  GET    /api/gamelog/:user_id           — view a user's gamelog by user_id

  User identity comes from the X-Nexus-User-Id header injected by the
  Nexus proxy on every authenticated request. We never trust a user_id
  from the request body for write operations.
  """

  use Phoenix.Controller, formats: [:json]

  alias Gamepedia.Gamelogs

  # ---------------------------------------------------------------------------
  # POST /api/gamelog
  # ---------------------------------------------------------------------------

  def add(conn, %{"game_id" => game_id}) do
    user_id = get_req_header(conn, "x-nexus-user-id") |> List.first() |> parse_int()

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

  def add(conn, _),
    do: conn |> put_status(:bad_request) |> json(%{error: "Required: game_id"})

  # ---------------------------------------------------------------------------
  # DELETE /api/gamelog/:game_id
  # ---------------------------------------------------------------------------

  def remove(conn, %{"game_id" => game_id}) do
    user_id = get_req_header(conn, "x-nexus-user-id") |> List.first() |> parse_int()

    if user_id == 0 do
      conn |> put_status(:unauthorized) |> json(%{error: "Not authenticated"})
    else
      case Gamelogs.remove(user_id, parse_int(game_id)) do
        {:ok, :removed}      -> json(conn, %{ok: true})
        {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "Not in gamelog"})
      end
    end
  end

  # ---------------------------------------------------------------------------
  # POST /api/gamelog/:game_id/playing
  # ---------------------------------------------------------------------------

  def toggle_playing(conn, %{"game_id" => game_id}) do
    user_id = get_req_header(conn, "x-nexus-user-id") |> List.first() |> parse_int()

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
  # GET /api/gamelog/:user_id
  # ---------------------------------------------------------------------------

  def index(conn, %{"user_id" => user_id_str} = params) do
    user_id = parse_int(user_id_str)

    if user_id == 0 do
      conn |> put_status(:bad_request) |> json(%{error: "Invalid user_id"})
    else
      {games, total, genres, page, limit} = Gamelogs.list(user_id, params)

      # Viewer is the owner if their proxy-injected user id matches
      viewer_id = get_req_header(conn, "x-nexus-user-id") |> List.first() |> parse_int()
      is_owner  = viewer_id == user_id

      stats = if page == 1, do: Gamelogs.stats(user_id), else: nil

      json(conn, %{
        data: Enum.map(games, &game_json/1),
        meta: %{
          total:        total,
          per_page:     limit,
          current_page: page,
          last_page:    max(1, ceil(total / limit))
        },
        filters:  %{genres: genres},
        user_id:  user_id,
        is_owner: is_owner,
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

  defp parse_int(nil), do: 0
  defp parse_int(v) when is_integer(v), do: v
  defp parse_int(v) when is_binary(v) do
    case Integer.parse(v) do
      {i, _} -> i
      :error -> 0
    end
  end
end
