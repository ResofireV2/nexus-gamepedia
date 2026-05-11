defmodule Gamepedia.Digest do
  @moduledoc "Builds Nexus digest email sections for Gamepedia."

  import Ecto.Query
  alias Nexus.Repo
  alias Gamepedia.Games.Game

  def new_games(%{from: from_dt, to: to_dt}) do
    games =
      Repo.all(from g in Game,
        where: g.inserted_at >= ^from_dt and g.inserted_at <= ^to_dt,
        order_by: [desc: g.inserted_at],
        limit: 5)

    %{
      title:  "New Games",
      layout: "list",
      cta:    %{label: "Browse all games", url: "/ext/gamepedia/browse"},
      items:  Enum.map(games, fn g ->
        %{
          label:       g.name,
          sublabel:    [g.developer, release_year(g.first_release_date)]
                       |> Enum.reject(&is_nil/1) |> Enum.join(" · "),
          badge:       "NEW",
          badge_color: "#34d399",
          url:         "/ext/gamepedia/games/#{g.slug}",
        }
      end),
    }
  end

  def top_gamelogs(%{from: from_dt}) do
    games =
      Repo.all(from g in Game,
        join: gl in "gamepedia_gamelogs", on: gl.game_id == g.id,
        where: gl.inserted_at >= ^from_dt,
        group_by: [g.id, g.name, g.slug],
        order_by: [desc: count(gl.id)],
        limit: 5,
        select: %{name: g.name, slug: g.slug, count: count(gl.id)})

    %{
      title:  "Most Gamelog'd",
      layout: "leaderboard",
      items:  Enum.map(games, fn g ->
        %{label: g.name, value: "#{g.count} logs", url: "/ext/gamepedia/games/#{g.slug}"}
      end),
    }
  end

  defp release_year(nil), do: nil
  defp release_year(ts),  do: ts |> DateTime.from_unix!() |> Map.get(:year) |> Integer.to_string()
end
