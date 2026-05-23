defmodule Gamepedia.Migrations.V20260523000005CreatePostGame do
  use Ecto.Migration

  def change do
    create table(:gamepedia_post_game) do
      add :post_id, :integer, null: false   # references nexus posts table
      add :game_id, references(:gamepedia_games, on_delete: :delete_all), null: false

      add :inserted_at, :utc_datetime, null: false
    end

    create unique_index(:gamepedia_post_game, [:post_id, :game_id])
    create index(:gamepedia_post_game, [:game_id])
    create index(:gamepedia_post_game, [:post_id])
  end
end
