defmodule Gamepedia.WidgetController do
  use Phoenix.Controller, formats: [:json]

  alias Nexus.Repo
  alias Gamepedia.Games.Game
  import Ecto.Query

  # GET /widgets/most-discussed?period=week|month|all
  def most_discussed(conn, params) do
    period = Map.get(params, "period", "week")
    limit  = 5

    from_dt = period_start(period)

    query =
      from g in Game,
        join: pg in "gamepedia_post_games", on: pg.game_id == g.id,
        join: p in Nexus.Forum.Post, on: p.id == pg.post_id,
        where: p.hidden == false,
        group_by: [g.id, g.name, g.slug, g.cover_image_url, g.first_release_date, g.developer],
        order_by: [desc: count(pg.id)],
        limit: ^limit,
        select: %{
          id:              g.id,
          name:            g.name,
          slug:            g.slug,
          cover_image_url: g.cover_image_url,
          release_year:    fragment("EXTRACT(YEAR FROM to_timestamp(?))::int", g.first_release_date),
          developer:       g.developer,
          thread_count:    count(pg.id),
        }

    query = if from_dt, do: where(query, [g, pg, p], pg.inserted_at >= ^from_dt), else: query

    json(conn, %{data: Repo.all(query)})
  end

  # GET /widgets/most-gamelogd?period=week|month|all
  def most_gamelogd(conn, params) do
    period  = Map.get(params, "period", "week")
    limit   = 5
    from_dt = period_start(period)

    query =
      from g in Game,
        join: gl in "gamepedia_gamelogs", on: gl.game_id == g.id,
        group_by: [g.id, g.name, g.slug, g.cover_image_url, g.first_release_date, g.developer],
        order_by: [desc: count(gl.id)],
        limit: ^limit,
        select: %{
          id:              g.id,
          name:            g.name,
          slug:            g.slug,
          cover_image_url: g.cover_image_url,
          release_year:    fragment("EXTRACT(YEAR FROM to_timestamp(?))::int", g.first_release_date),
          developer:       g.developer,
          gamelog_count:   count(gl.id),
        }

    query = if from_dt, do: where(query, [g, gl], gl.inserted_at >= ^from_dt), else: query

    json(conn, %{data: Repo.all(query)})
  end

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  defp period_start("week"),  do: DateTime.add(DateTime.utc_now(), -7,  :day)
  defp period_start("month"), do: DateTime.add(DateTime.utc_now(), -30, :day)
  defp period_start(_),       do: nil
end
