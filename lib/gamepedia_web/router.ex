defmodule GamepediaWeb.Router do
  use Phoenix.Router

  pipeline :api do
    plug :accepts, ["json"]
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

    # Stage 2 — Admin game management
    post   "/admin/games/import",      AdminGameController, :import
    post   "/admin/games/:id/refresh", AdminGameController, :refresh
    post   "/admin/games/:id/genres",  AdminGameController, :update_genres
    delete "/admin/games/:id",         AdminGameController, :delete

    # Stage 2 — Genre management
    get    "/admin/genres",     GenreController, :index
    post   "/admin/genres",     GenreController, :create
    patch  "/admin/genres/:id", GenreController, :update
    delete "/admin/genres/:id", GenreController, :delete
  end
end
