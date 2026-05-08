defmodule GamepediaWeb.Router do
  use Phoenix.Router

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/", GamepediaWeb do
    pipe_through :api

    # Stage 3 — Nexus webhook receiver
    post "/webhook", WebhookController, :handle
  end

  scope "/api", GamepediaWeb do
    pipe_through :api

    # Health check
    get "/health", HealthController, :index

    # Stage 1 — IGDB search
    get "/games/search", GameController, :igdb_search

    # Stage 2 — Game library (public)
    get  "/games",       GameController, :index
    get  "/games/:slug", GameController, :show

    # Stage 4 — Post game linking
    post "/posts/:post_id/games", PostGameController, :create
    get  "/posts/:post_id/games", PostGameController, :index

    # Stage 5 — Gamelog
    post   "/gamelog",                    GamelogController, :add
    delete "/gamelog/:game_id",           GamelogController, :remove
    post   "/gamelog/:game_id/playing",   GamelogController, :toggle_playing
    get    "/gamelog/:username",          GamelogController, :index

    # Admin game management
    get    "/admin/games",             AdminGameController, :index
    post   "/admin/games/import",      AdminGameController, :import
    post   "/admin/games/:id/refresh", AdminGameController, :refresh
    post   "/admin/games/:id/genres",  AdminGameController, :update_genres
    delete "/admin/games/:id",         AdminGameController, :delete
    get    "/admin/stats",             AdminGameController, :stats

    # Stage 2 — Genre management
    get    "/admin/genres",     GenreController, :index
    post   "/admin/genres",     GenreController, :create
    patch  "/admin/genres/:id", GenreController, :update
    delete "/admin/genres/:id", GenreController, :delete
  end
end
