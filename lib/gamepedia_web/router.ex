defmodule GamepediaWeb.Router do
  use Phoenix.Router

  pipeline :api do
    plug :accepts, ["json"]
  end

  # ---------------------------------------------------------------------------
  # Stage 1 — IGDB search (public for testing, will be admin-auth in Stage 2)
  # ---------------------------------------------------------------------------
  scope "/api", GamepediaWeb do
    pipe_through :api

    # Health check
    get "/health", HealthController, :index

    # IGDB game search — requires ?q=, ?client_id=, ?client_secret=
    # In Stage 2 credentials come from stored settings, not query params
    get "/games/search", GameController, :search
  end
end
