defmodule GamepediaWeb.DigestController do
  @moduledoc """
  POST /digest/new_games      — new games added during the digest period
  POST /digest/top_gamelogs   — most gamelog'd games during the digest period
  """

  use Phoenix.Controller, formats: [:json]

  import Ecto.Query
  alias Gamepedia.Repo
  alias Gamepedia.Games.Game

  # ---------------------------------------------------------------------------
  # POST /digest/new_games
  # ---------------------------------------------------------------------------

  def new_games(conn, params) do
    from_dt = parse_dt(params["from"])
    to_dt   = parse_dt(params["to"])

    games =
      from(g in Game,
        where: g.inserted_at >= ^from_dt and g.inserted_at <= ^to_dt,
        order_by: [desc: g.inserted_at],
        limit: 5
      )
      |> Repo.all()

    items = Enum.map(games, fn g ->
      %{
        label:       g.name,
        sublabel:    [g.developer, release_year(g.first_release_date)] |> Enum.reject(&is_nil/1) |> Enum.join(" \u00B7 "),
        badge:       "NEW",
        badge_color: "#34d399",
        url:         "https://billyrayfoss.com/gamepedia/games/#{g.slug}"
      }
    end)

    json(conn, %{
      title:  "New Games",
      layout: "list",
      cta:    %{label: "Browse all games", url: "https://billyrayfoss.com/gamepedia/games"},
      items:  items
    })
  end

  # ---------------------------------------------------------------------------
  # POST /digest/top_gamelogs
  # ---------------------------------------------------------------------------

  def top_gamelogs(conn, params) do
    from_dt = parse_dt(params["from"])

    games =
      from(g in Game,
        join: gl in "gamepedia_gamelogs", on: gl.game_id == g.id,
        where: gl.inserted_at >= ^from_dt,
        group_by: [g.id, g.name, g.slug],
        order_by: [desc: count(gl.id)],
        limit: 5,
        select: %{name: g.name, slug: g.slug, count: count(gl.id)}
      )
      |> Repo.all()

    items = Enum.map(games, fn g ->
      %{
        label: g.name,
        value: "#{g.count} logs",
        url:   "https://billyrayfoss.com/gamepedia/games/#{g.slug}"
      }
    end)

    json(conn, %{
      title:  "Most Gamelog\u2019d",
      layout: "leaderboard",
      items:  items
    })
  end

  # ---------------------------------------------------------------------------
  # Private
  # ---------------------------------------------------------------------------

  defp parse_dt(nil), do: ~U[2000-01-01 00:00:00Z]
  defp parse_dt(s) do
    case DateTime.from_iso8601(s) do
      {:ok, dt, _} -> dt
      _            -> ~U[2000-01-01 00:00:00Z]
    end
  end

  defp release_year(nil), do: nil
  defp release_year(ts),  do: ts |> DateTime.from_unix!() |> Map.get(:year) |> Integer.to_string()
end
