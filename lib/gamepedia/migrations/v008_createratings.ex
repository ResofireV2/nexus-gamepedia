defmodule Gamepedia.Migrations.V20260523000008CreateRatings do
  use Ecto.Migration

  def change do
    create_if_not_exists table(:gamepedia_ratings) do
      add :user_id, :integer, null: false   # references nexus users table
      add :game_id, references(:gamepedia_games, on_delete: :delete_all), null: false
      add :rating,  :integer, null: false

      add :inserted_at, :utc_datetime, null: false
    end

    create_if_not_exists unique_index(:gamepedia_ratings, [:user_id, :game_id])
    create_if_not_exists index(:gamepedia_ratings, [:game_id])
  end
end
