defmodule Gamepedia.Migrations.V007CreateGamelogs do
  use Ecto.Migration

  def change do
    create table(:gamepedia_gamelogs) do
      add :user_id,    :integer, null: false   # references nexus users table
      add :game_id,    references(:gamepedia_games, on_delete: :delete_all), null: false
      add :is_playing, :boolean, default: false, null: false

      add :inserted_at, :utc_datetime, null: false
    end

    create unique_index(:gamepedia_gamelogs, [:user_id, :game_id])
    create index(:gamepedia_gamelogs, [:game_id])
    create index(:gamepedia_gamelogs, [:user_id])
  end
end
