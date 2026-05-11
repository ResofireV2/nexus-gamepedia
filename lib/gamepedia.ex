defmodule Gamepedia do
  @moduledoc """
  Gamepedia — a game database extension for Nexus.

  Powered by IGDB. Browse games, link threads to games, track your gamelog.
  Runs inside the Nexus VM with no separate container or service required.
  """

  use Nexus.Extensions.Behaviour

  # ---------------------------------------------------------------------------
  # Manifest
  # ---------------------------------------------------------------------------

  @impl true
  def manifest do
    %{
      slug:        "gamepedia",
      name:        "Gamepedia",
      description: "A game database powered by IGDB. Browse games, link threads to games, and track your gamelog.",
      author:      "ResofireV2",
      homepage:    "https://github.com/ResofireV2/nexus-gamepedia",
      logo_url:    "/ext/gamepedia/assets/logo.webp",
      banner_url:  "/ext/gamepedia/assets/banner.webp",
      categories:  ["games", "integrations"],
    }
  end

  # ---------------------------------------------------------------------------
  # Migrations — run by Nexus on install/update, rolled back on uninstall
  # ---------------------------------------------------------------------------

  @impl true
  def migrations do
    [
      Gamepedia.Migrations.V001CreateGenres,
      Gamepedia.Migrations.V002CreateGames,
      Gamepedia.Migrations.V003CreateScreenshots,
      Gamepedia.Migrations.V004CreateGameGenre,
      Gamepedia.Migrations.V005CreatePostGame,
      Gamepedia.Migrations.V006CreateAwards,
      Gamepedia.Migrations.V007CreateGamelogs,
      Gamepedia.Migrations.V008CreateRatings,
      Gamepedia.Migrations.V009AddLocalPathsToScreenshots,
    ]
  end

  # ---------------------------------------------------------------------------
  # API routes — mounted at /ext/gamepedia/ by Nexus
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
  def on_install(_settings), do: :ok

  @impl true
  def on_update(_from, _to), do: :ok

  @impl true
  def on_uninstall do
    # Clean up screenshot files
    Nexus.Extensions.Storage.delete_all("gamepedia")
    :ok
  end

  # ---------------------------------------------------------------------------
  # JS bundle
  # ---------------------------------------------------------------------------

  @impl true
  def js_bundle_path, do: "gamepedia.js"

  # ---------------------------------------------------------------------------
  # Admin settings schema
  # ---------------------------------------------------------------------------

  @impl true
  def settings_schema do
    %{
      "igdb_client_id" => %{
        "type"        => "string",
        "label"       => "IGDB Client ID",
        "placeholder" => "Your Twitch app client ID",
        "required"    => true,
      },
      "igdb_client_secret" => %{
        "type"        => "string",
        "label"       => "IGDB Client Secret",
        "placeholder" => "Your Twitch app client secret",
        "secret"      => true,
        "required"    => true,
      },
    }
  end

  @impl true
  def settings_tabs do
    [
      %{
        "key"    => "credentials",
        "label"  => "Credentials",
        "icon"   => "fa-key",
        "fields" => ["igdb_client_id", "igdb_client_secret"],
      },
    ]
  end

  # ---------------------------------------------------------------------------
  # Digest sections
  # ---------------------------------------------------------------------------

  @impl true
  def digest_sections do
    [
      %{
        key:                "gamepedia_new_games",
        label:              "New Games",
        icon:               "fa-gamepad",
        enabled_by_default: true,
      },
      %{
        key:                "gamepedia_top_gamelogs",
        label:              "Most Gamelog'd",
        icon:               "fa-star",
        enabled_by_default: true,
      },
    ]
  end

  @impl true
  def handle_digest_section("gamepedia_new_games", period, _settings) do
    Gamepedia.Digest.new_games(period)
  end

  def handle_digest_section("gamepedia_top_gamelogs", period, _settings) do
    Gamepedia.Digest.top_gamelogs(period)
  end

  def handle_digest_section(_key, _period, _settings), do: %{items: []}
end
