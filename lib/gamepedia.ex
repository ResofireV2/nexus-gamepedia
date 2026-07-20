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

  # Migration naming
  #
  # Use simple sequential names: V1, V2, V3, etc. Nexus derives a
  # collision-free schema_migrations version integer by hashing the string
  # "gamepedia:N", producing a 10-digit value that never collides with
  # Nexus core's 14-digit timestamp migrations or another extension's V1.
  #
  # Write idempotent migrations: use create_if_not_exists for tables and
  # indexes, add_if_not_exists for columns. When adding migrations, just
  # increment: V10, V11, V12, ...
  @impl true
  def migrations do
    [
      Gamepedia.Migrations.V1CreateGenres,
      Gamepedia.Migrations.V2CreateGames,
      Gamepedia.Migrations.V3CreateScreenshots,
      Gamepedia.Migrations.V4CreateGameGenre,
      Gamepedia.Migrations.V5CreatePostGame,
      Gamepedia.Migrations.V6CreateAwards,
      Gamepedia.Migrations.V7CreateGamelogs,
      Gamepedia.Migrations.V8CreateRatings,
      Gamepedia.Migrations.V9AddLocalPathsToScreenshots,
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
  # Supervised processes
  # ---------------------------------------------------------------------------

  # TokenCache owns the ETS table holding the cached Twitch/IGDB OAuth token.
  # An ETS table dies with the process that created it, so creating it lazily
  # from a request process meant it was destroyed as soon as the response was
  # sent and every IGDB call re-authenticated. Owning it from a supervised
  # process started here keeps it alive for the life of the extension.
  @impl true
  def child_specs do
    [Gamepedia.TokenCache]
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

  # No on_uninstall/0 callback.
  #
  # Screenshot files used to be deleted here, but Nexus already calls
  # Nexus.Extensions.Storage.delete_all/1 for the extension in both
  # uninstall_extension/1 and force_uninstall_extension/1. Doing it again
  # from the callback was redundant, and force-uninstall skips on_uninstall/0
  # entirely — so the core path is the one that actually guarantees cleanup.

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
