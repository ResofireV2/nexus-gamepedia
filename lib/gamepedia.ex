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

  # Migration version numbers — IMPORTANT
  #
  # The loader extracts an integer version from each module's `V<digits>...`
  # name and passes it to `Ecto.Migrator.up/3`. That integer is recorded in
  # the `schema_migrations` table, which is SHARED across Nexus core and
  # every installed extension. If our version integer already exists in
  # that table — from a Nexus core migration with the same number — Ecto
  # silently skips the migration and the table never gets created.
  #
  # Nexus core uses `YYYYMMDDHHMMSS`-style integers in the range
  # `20260501000001` through `20260521000002` (as of Nexus 0.1.0-beta).
  # We use `20260523...` which postdates Nexus's range. If you add new
  # migrations, keep them above Nexus core's latest version. Don't reset
  # the date prefix.
  #
  # This isn't covered by EXTENSION_GUIDE.md §8.5 directly — the guide's
  # examples use either `V001`-style or `V<YYYYMMDD>...` style without
  # warning that values colliding with Nexus core's own migration numbers
  # will be silently skipped.
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
