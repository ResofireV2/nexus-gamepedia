defmodule Gamepedia.Router do
  use Phoenix.Router, helpers: false

  pipeline :api do
    plug :accepts, ["json"]
    plug :fetch_query_params
  end

  scope "/", Gamepedia do
    pipe_through :api

    # Public — game library
    get  "/games",       GameController, :index
    get  "/games/search", GameController, :igdb_search
    get  "/games/:slug", GameController, :show

    # Public — sidebar widgets
    get  "/widgets/most-discussed", WidgetController, :most_discussed
    get  "/widgets/most-gamelogd",  WidgetController, :most_gamelogd

    # Public — post ↔ game association (reads only; writes via attach() / persist_attachment/3)
    get  "/posts/:post_id/games", PostGameController, :index
    get  "/games/:game_id/posts", PostGameController, :posts_for_game

    # Public — gamelog
    post   "/gamelog",                  GamelogController, :add
    delete "/gamelog/:game_id",         GamelogController, :remove
    post   "/gamelog/:game_id/playing", GamelogController, :toggle_playing
    get    "/gamelog/:user_id",         GamelogController, :index

    # Public — ratings
    get    "/games/:game_id/ratings",  RatingController, :summary
    post   "/games/:game_id/rate",     RatingController, :rate
    delete "/games/:game_id/rate",     RatingController, :delete_rating

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

    # Admin — awards management
    get    "/admin/games/:game_id/awards", AwardController, :index
    post   "/admin/games/:game_id/awards", AwardController, :create
    patch  "/admin/awards/:id",            AwardController, :update
    delete "/admin/awards/:id",            AwardController, :delete
  end
end
