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

    items = Enum.map(games, fn g ->
      %{label: g.name, sublabel: subtitle(g), badge: "NEW",
        badge_color: "#34d399", cover_image_url: g.cover_image_url,
        url: "/ext/gamepedia/games/#{g.slug}"}
    end)

    rendered = render_game_cards("New Games", items, nil, branding)
    %{"_rendered_html" => rendered}
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

    items = Enum.map(games, fn g ->
      %{label: g.name, sublabel: subtitle(g), value: "#{g.count} logs",
        cover_image_url: g.cover_image_url, url: "/ext/gamepedia/games/#{g.slug}"}
    end)

    rendered = render_game_cards("Most Gamelog\u2019d", items, nil, branding)
    %{"_rendered_html" => rendered}
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

    items = Enum.map(games, fn g ->
      %{label: g.name, sublabel: subtitle(g), value: "#{g.count} threads",
        cover_image_url: g.cover_image_url, url: "/ext/gamepedia/games/#{g.slug}"}
    end)

    rendered = render_game_cards("Most Discussed", items, nil, branding)
    %{"_rendered_html" => rendered}
  end

  # ---------------------------------------------------------------------------
  # HTML renderer — game card grid
  # ---------------------------------------------------------------------------

  defp render_game_cards(title, items, cta, branding) do
    accent   = Map.get(branding, :accent,  "#a78bfa")
    text_1   = Map.get(branding, :text_1,  "#f0eeff")
    text_3   = Map.get(branding, :text_3,  "rgba(255,255,255,0.55)")
    text_4   = Map.get(branding, :text_4,  "rgba(255,255,255,0.35)")
    border   = Map.get(branding, :border,  "rgba(255,255,255,0.08)")
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

          href_open  = if item_url, do: "<a href=\"" <> base_url <> item_url <> "\" style=\"text-decoration:none;\">", else: "<span>"
          href_close = if item_url, do: "</a>", else: "</span>"

          cover_html = if cover do
            "<img src=\"" <> cover <> "\" width=\"80\" height=\"107\" " <>
            "style=\"width:80px;height:107px;object-fit:cover;border-radius:6px;" <>
            "display:block;border:0.5px solid " <> border <> ";\" />"
          else
            "<div style=\"width:80px;height:107px;border-radius:6px;" <>
            "background:rgba(255,255,255,0.06);border:0.5px solid " <> border <> ";\">" <>
            "</div>"
          end

          badge_html = if badge do
            bc = item[:badge_color] || accent
            "<div style=\"margin-top:4px;display:inline-block;background:" <> bc <>
            "22;color:" <> bc <> ";font-size:9px;font-weight:700;padding:2px 5px;" <>
            "border-radius:3px;letter-spacing:.04em;\">" <> badge <> "</div>"
          else "" end

          value_html = if value do
            "<div style=\"font-size:10px;color:" <> text_4 <> ";margin-top:2px;\">" <> value <> "</div>"
          else "" end

          "<td style=\"width:33%;padding:0 6px 16px;vertical-align:top;\">" <>
          href_open <>
          cover_html <>
          "<div style=\"margin-top:6px;font-size:11px;font-weight:500;color:" <> text_1 <>
          ";line-height:1.3;\">" <> label <> "</div>" <>
          "<div style=\"font-size:10px;color:" <> text_3 <> ";margin-top:2px;\">" <> sublabel <> "</div>" <>
          badge_html <> value_html <>
          href_close <>
          "</td>"
        end)

        pad = cols - length(row)
        padding = if pad > 0, do: String.duplicate("<td style=\"width:33%;padding:0 6px;\"></td>", pad), else: ""
        "<tr>" <> cells <> padding <> "</tr>"
      end)

    cta_html = if cta do
      cta_href  = if cta[:url], do: base_url <> cta[:url], else: base_url
      cta_label = cta[:label] || ""
      "<p style=\"margin:12px 0 0;\"><a href=\"" <> cta_href <>
      "\" style=\"color:" <> accent <> ";font-size:13px;\">" <> cta_label <> " \u2192</a></p>"
    else "" end

    divider_html = "<div style=\"height:0.5px;background:" <> divider <> ";margin:24px 0;\"></div>"

    "<p style=\"margin:0 0 12px;font-size:11px;font-weight:500;color:" <> text_4 <>
    ";text-transform:uppercase;letter-spacing:0.8px;\">" <> title <> "</p>" <>
    "<table cellpadding=\"0\" cellspacing=\"0\" width=\"100%\" style=\"margin-bottom:8px;\">" <>
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
