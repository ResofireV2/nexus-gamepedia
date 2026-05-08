defmodule Gamepedia.Application do
  use Application

  @impl true
  def start(_type, _args) do
    # Initialise ETS table for IGDB token caching before any workers start
    Gamepedia.Igdb.init_cache()

    children = [
      Gamepedia.Repo,
      {Phoenix.PubSub, name: Gamepedia.PubSub},
      GamepediaWeb.Endpoint
    ]

    opts = [strategy: :one_for_one, name: Gamepedia.Supervisor]
    Supervisor.start_link(children, opts)
  end

  @impl true
  def config_change(changed, _new, removed) do
    GamepediaWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
