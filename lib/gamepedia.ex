defmodule Gamepedia do
  @moduledoc """
  Gamepedia — a game database extension for Nexus.

  Powered by IGDB. Browse games, link threads to games, track your gamelog.
  Runs inside the Nexus VM with no separate container or service required.

  All identity, surfaces, and settings are declared in `manifest.json`
  (manifest_version 2). This module provides only the Elixir-side
  callback implementations.
  """

  use Nexus.Extensions.Behaviour

  # ---------------------------------------------------------------------------
  # Migrations — run by Nexus on install/update, rolled back on uninstall
  # ---------------------------------------------------------------------------

  # Migration version numbers + idempotence — IMPORTANT
  #
  # Nexus's loader calls `Ecto.Migrator.up/3` for every migration module on
  # every boot via `Extensions.load_all_enabled/0`. That's normally a no-op
  # because `Ecto.Migrator` skips versions already recorded in
  # `schema_migrations`. But two failure modes can desync versions from
  # actual table state:
  #
  #   1. Version collision: `schema_migrations` is SHARED across Nexus core
  #      and every installed extension. If our version integer collides with
  #      a Nexus core migration that already ran, Ecto silently skips us and
  #      our table never gets created. We avoid this by prefixing versions
  #      with `20260523...` — above Nexus core's `20260501...20260521` range.
  #
  #   2. Version rename across releases: if an earlier Gamepedia release
  #      used different version numbers (we did — pre-hotfix versions were
  #      `20260501000001...20260510000001`), the database has the OLD
  #      versions recorded but the tables they created persist. When we
  #      install with NEW version numbers, every boot retries them, and
  #      every retry fails because the tables already exist. The user sees
  #      `relation "gamepedia_games" already exists` on a fresh boot with
  #      no install or update event.
  #
  # The defence against both is the same: write idempotent migrations.
  # `create_if_not_exists table/index` and `add_if_not_exists` column let
  # the migration succeed (and record its version) regardless of whether
  # the schema changes are already in place. After one successful boot the
  # new versions are recorded; future boots skip cleanly.
  #
  # If you add new migrations, keep them above Nexus core's latest version
  # AND use the `_if_not_exists` variants for every DDL operation. Don't
  # reset the date prefix.
  @impl true
  def migrations do
    [
      Gamepedia.Migrations.V20260523000001CreateGenres,
      Gamepedia.Migrations.V20260523000002CreateGames,
      Gamepedia.Migrations.V20260523000003CreateScreenshots,
      Gamepedia.Migrations.V20260523000004CreateGameGenre,
      Gamepedia.Migrations.V20260523000005CreatePostGame,
      Gamepedia.Migrations.V20260523000006CreateAwards,
      Gamepedia.Migrations.V20260523000007CreateGamelogs,
      Gamepedia.Migrations.V20260523000008CreateRatings,
      Gamepedia.Migrations.V20260523000009AddLocalPathsToScreenshots,
    ]
  end

  # ---------------------------------------------------------------------------
  # API routes — mounted at /ext/gamepedia/api/ by Nexus's ExtensionRouter
  # ---------------------------------------------------------------------------

  @impl true
  def routes do
    [{"/", Gamepedia.Router, []}]
  end

  # ---------------------------------------------------------------------------
  # Hook events
  # ---------------------------------------------------------------------------

  @impl true
  def handle_event("post_deleted", %{"post_id" => post_id}, _settings) do
    Gamepedia.PostGames.delete_links_for_post(post_id)
  end

  def handle_event(_event, _payload, _settings), do: :ok

  # ---------------------------------------------------------------------------
  # Lifecycle
  # ---------------------------------------------------------------------------

  @impl true
  def on_uninstall do
    # Clean up screenshot files and any other extension-owned storage.
    Nexus.Extensions.Storage.delete_all("gamepedia")
    :ok
  end

  # ---------------------------------------------------------------------------
  # Compose attachment persistence (side_data)
  #
  # Toolbar button "gamepedia-link-game" calls attach({kind, data}) for each
  # selected game. Nexus dispatches each attachment here after the post is
  # committed. One attachment = one game link.
  # ---------------------------------------------------------------------------

  @impl true
  def persist_attachment("post", post_id, %{"kind" => "game_link", "data" => %{"game_id" => game_id}})
      when is_integer(game_id) do
    Gamepedia.PostGames.link_games(post_id, [game_id])
  end

  def persist_attachment(_entity, _entity_id, _attachment), do: :ok

  # ---------------------------------------------------------------------------
  # Digest sections
  #
  # Branding (colours) comes from Nexus.Mailer.branding_context/0 rather than
  # being passed as a 4th argument; the 3-arity callback is the contract.
  # ---------------------------------------------------------------------------

  @impl true
  def handle_digest_section("gamepedia_new_games", period, settings) do
    Gamepedia.Digest.new_games(period, settings)
  end

  def handle_digest_section("gamepedia_top_gamelogs", period, settings) do
    Gamepedia.Digest.top_gamelogs(period, settings)
  end

  def handle_digest_section("gamepedia_most_discussed", period, settings) do
    Gamepedia.Digest.most_discussed(period, settings)
  end

  def handle_digest_section(_key, _period, _settings), do: %{items: []}
end
