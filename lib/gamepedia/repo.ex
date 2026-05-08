defmodule Gamepedia.Repo do
  use Ecto.Repo,
    otp_app: :gamepedia,
    adapter: Ecto.Adapters.Postgres
end
