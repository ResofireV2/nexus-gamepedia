defmodule Gamepedia.Digest do
  @moduledoc "Builds Nexus digest email sections for Gamepedia."

  import Ecto.Query
  alias Nexus.Repo
  alias Gamepedia.Games.Game

  def new_games(%{from: from_dt, to: to_dt}, settings \\ %{}, branding \\ %{}) do
    limit = get_count(settings, "digest_new_games_count", 6)
    games = Repo.all(from g in Game,
      where: g.inserted_at >= ^from_dt and g.inserted_at <= ^to_dt,
      order_by: [desc: g.inserted_at],
      limit: ^limit,
      select: %{name: g.name, slug: g.slug, developer: g.developer,
                cover_image_url: g.cover_image_url, first_release_date: g.first_release_date})

    if games == [] do
      %{items: []}
    else
      items = Enum.map(games, fn g ->
        %{label: g.name, sublabel: subtitle(g), badge: "NEW",
          badge_color: "#34d399", cover_image_url: g.cover_image_url,
          url: "/ext/gamepedia/games/#{g.slug}"}
      end)

      rendered = render_game_cards("New Games", items, nil, branding)
      %{"_rendered_html" => rendered}
    end
  end

  def top_gamelogs(%{from: from_dt}, settings \\ %{}, branding \\ %{}) do
    limit = get_count(settings, "digest_top_gamelogs_count", 6)
    games = Repo.all(from g in Game,
      join: gl in "gamepedia_gamelogs", on: gl.game_id == g.id,
      where: gl.inserted_at >= ^from_dt,
      group_by: [g.id, g.name, g.slug, g.developer, g.cover_image_url, g.first_release_date],
      order_by: [desc: count(gl.id)],
      limit: ^limit,
      select: %{name: g.name, slug: g.slug, developer: g.developer,
                cover_image_url: g.cover_image_url, first_release_date: g.first_release_date,
                count: count(gl.id)})

    if games == [] do
      %{items: []}
    else
      items = Enum.map(games, fn g ->
        %{label: g.name, sublabel: subtitle(g), value: "#{g.count} logs",
          cover_image_url: g.cover_image_url, url: "/ext/gamepedia/games/#{g.slug}"}
      end)

      rendered = render_game_cards("Most Gamelog\u2019d", items, nil, branding)
      %{"_rendered_html" => rendered}
    end
  end

  def most_discussed(%{from: from_dt, to: to_dt}, settings \\ %{}, branding \\ %{}) do
    limit = get_count(settings, "digest_most_discussed_count", 6)
    games = Repo.all(from g in Game,
      join: pg in "gamepedia_post_games", on: pg.game_id == g.id,
      join: p in Nexus.Forum.Post, on: p.id == pg.post_id,
      where: pg.inserted_at >= ^from_dt and pg.inserted_at <= ^to_dt,
      where: p.hidden == false,
      group_by: [g.id, g.name, g.slug, g.developer, g.cover_image_url, g.first_release_date],
      order_by: [desc: count(pg.id)],
      limit: ^limit,
      select: %{name: g.name, slug: g.slug, developer: g.developer,
                cover_image_url: g.cover_image_url, first_release_date: g.first_release_date,
                count: count(pg.id)})

    if games == [] do
      %{items: []}
    else
      items = Enum.map(games, fn g ->
        %{label: g.name, sublabel: subtitle(g), value: "#{g.count} threads",
          cover_image_url: g.cover_image_url, url: "/ext/gamepedia/games/#{g.slug}"}
      end)

      rendered = render_game_cards("Most Discussed", items, nil, branding)
      %{"_rendered_html" => rendered}
    end
  end

  # ---------------------------------------------------------------------------
  # HTML renderer — game card grid
  # ---------------------------------------------------------------------------

  defp render_game_cards(title, items, cta, branding) do
    accent   = Map.get(branding, :accent,  "#a78bfa")
    text_1   = Map.get(branding, :text_1,  "#f0eeff")
    text_4   = Map.get(branding, :text_4,  "rgba(255,255,255,0.35)")
    divider  = Map.get(branding, :divider, "rgba(255,255,255,0.08)")
    base_url = Nexus.Mailer.base_url()

    cols = 3
    rows_html = items
      |> Enum.chunk_every(cols)
      |> Enum.map_join("", fn row ->
        cells = Enum.map_join(row, "", fn item ->
          label    = item[:label] || ""
          sublabel = item[:sublabel] || ""
          value    = item[:value]
          badge    = item[:badge]
          cover    = item[:cover_image_url]
          item_url = item[:url]

          href_open  = if item_url, do: "<a href=\"" <> base_url <> item_url <> "\" style=\"text-decoration:none;display:block;\">", else: "<div>"
          href_close = if item_url, do: "</a>", else: "</div>"

          cover_html = if cover do
            "<img src=\"" <> cover <> "\" width=\"120\" height=\"160\" " <>
            "style=\"width:100%;height:160px;object-fit:cover;display:block;border-radius:8px 8px 0 0;\" />"
          else
            "<div style=\"width:100%;height:160px;border-radius:8px 8px 0 0;" <>
            "background:rgba(255,255,255,0.06);display:flex;align-items:center;" <>
            "justify-content:center;font-size:28px;color:rgba(255,255,255,0.2);\">" <>
            "&#9670;</div>"
          end

          badge_html = if badge do
            bc = item[:badge_color] || accent
            "<span style=\"display:inline-block;background:" <> bc <>
            "22;color:" <> bc <> ";font-size:9px;font-weight:700;padding:2px 6px;" <>
            "border-radius:20px;letter-spacing:.05em;margin-top:3px;\">" <> badge <> "</span>"
          else "" end

          value_html = if value do
            "<div style=\"font-size:10px;color:" <> accent <> ";margin-top:3px;font-weight:500;\">" <> value <> "</div>"
          else "" end

          info_html =
            "<div style=\"padding:8px;background:rgba(255,255,255,0.03);border-radius:0 0 8px 8px;\">" <>
            "<div style=\"font-size:12px;font-weight:500;color:" <> text_1 <>
            ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis;\">" <> label <> "</div>" <>
            "<div style=\"font-size:11px;color:" <> text_4 <> ";margin-top:2px;" <>
            "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;\">" <> sublabel <> "</div>" <>
            badge_html <> value_html <>
            "</div>"

          "<td style=\"width:33%;padding:0 4px 10px;vertical-align:top;\">" <>
          "<div style=\"background:rgba(255,255,255,0.04);border:0.5px solid rgba(255,255,255,0.08);" <>
          "border-radius:10px;overflow:hidden;\">" <>
          href_open <> cover_html <> href_close <>
          info_html <>
          "</div>" <>
          "</td>"
        end)

        pad = cols - length(row)
        padding = if pad > 0, do: String.duplicate("<td style=\"width:33%;padding:0 4px 10px;\"></td>", pad), else: ""
        "<tr>" <> cells <> padding <> "</tr>"
      end)

    cta_html = if cta do
      cta_href  = if cta[:url], do: base_url <> cta[:url], else: base_url
      cta_label = cta[:label] || ""
      "<p style=\"margin:12px 0 0;\"><a href=\"" <> cta_href <>
      "\" style=\"color:" <> accent <> ";font-size:13px;\">" <> cta_label <> " \u2192</a></p>"
    else "" end

    divider_html = "<div style=\"height:0.5px;background:" <> divider <> ";margin:24px 0;\"></div>"

    "<p style=\"margin:0 0 14px;font-size:11px;font-weight:500;color:" <> text_4 <>
    ";text-transform:uppercase;letter-spacing:0.8px;\">" <> title <> "</p>" <>
    "<table cellpadding=\"0\" cellspacing=\"0\" width=\"100%\" style=\"margin-bottom:8px;table-layout:fixed;\">" <>
    rows_html <> "</table>" <>
    cta_html <>
    divider_html
  end

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  defp subtitle(g) do
    [g.developer, release_year(g.first_release_date)]
    |> Enum.reject(&is_nil/1)
    |> Enum.join(" · ")
  end

  defp get_count(settings, key, default) do
    case settings[key] do
      v when is_integer(v) and v > 0 -> v
      v when is_binary(v)            ->
        case Integer.parse(v) do
          {n, _} when n > 0 -> n
          _                 -> default
        end
      _ -> default
    end
  end

  defp release_year(nil), do: nil
  defp release_year(ts),  do: ts |> DateTime.from_unix!() |> Map.get(:year) |> Integer.to_string()
end
