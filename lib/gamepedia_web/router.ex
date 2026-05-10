defmodule GamepediaWeb.Router do
  use Phoenix.Router

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/", GamepediaWeb do
    pipe_through :api

    # Nexus webhook receiver
    post "/webhook", WebhookController, :handle

    # Digest email sections
    post "/digest/new_games",    DigestController, :new_games
    post "/digest/top_gamelogs", DigestController, :top_gamelogs
  end

  scope "/api", GamepediaWeb do
    pipe_through :api

    # Health
    get "/health", HealthController, :index

    # Public — IGDB search (used by admin Add Game modal)
    get "/games/search", GameController, :igdb_search

    # Public — game library
    get "/games",       GameController, :index
    get "/games/:slug", GameController, :show

    # Public — post game links
    post "/posts/:post_id/games", PostGameController, :create
    get  "/posts/:post_id/games", PostGameController, :index

    # Public — gamelog
    post   "/gamelog",                  GamelogController, :add
    delete "/gamelog/:game_id",         GamelogController, :remove
    post   "/gamelog/:game_id/playing", GamelogController, :toggle_playing
    get    "/gamelog/:user_id",          GamelogController, :index

    # Admin — game management
    get    "/admin/games",             AdminGameController, :index
    post   "/admin/games/import",      AdminGameController, :import
    post   "/admin/games/:id/refresh", AdminGameController, :refresh
    post   "/admin/games/:id/genres",  AdminGameController, :update_genres
    delete "/admin/games/:id",         AdminGameController, :delete
    get    "/admin/stats",             AdminGameController, :stats

    # Admin — genre management
    get    "/admin/genres",     GenreController, :index
    post   "/admin/genres",     GenreController, :create
    patch  "/admin/genres/:id", GenreController, :update
    delete "/admin/genres/:id", GenreController, :delete
  end
end
