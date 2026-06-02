defmodule Gamepedia.Migrations.V4CreateGameGenre do
  use Ecto.Migration

  def change do
    create_if_not_exists table(:gamepedia_game_genre, primary_key: false) do
      add :game_id,  references(:gamepedia_games,  on_delete: :delete_all), null: false
      add :genre_id, references(:gamepedia_genres, on_delete: :delete_all), null: false
    end

    create constraint(:gamepedia_game_genre, :game_genre_pk, check: "game_id IS NOT NULL")
    execute "ALTER TABLE gamepedia_game_genre ADD PRIMARY KEY (game_id, genre_id)",
            "ALTER TABLE gamepedia_game_genre DROP CONSTRAINT gamepedia_game_genre_pkey"

    create_if_not_exists index(:gamepedia_game_genre, [:genre_id])
  end
end
