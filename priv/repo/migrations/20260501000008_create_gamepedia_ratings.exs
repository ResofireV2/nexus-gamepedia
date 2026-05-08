defmodule Gamepedia.Repo.Migrations.CreateGamepediaRatings do
  use Ecto.Migration

  def change do
    create table(:gamepedia_ratings) do
      add :user_id, :integer, null: false   # references nexus users table
      add :game_id, references(:gamepedia_games, on_delete: :delete_all), null: false
      add :rating,  :integer, null: false

      add :inserted_at, :utc_datetime, null: false
    end

    create unique_index(:gamepedia_ratings, [:user_id, :game_id])
    create index(:gamepedia_ratings, [:game_id])
  end
end
