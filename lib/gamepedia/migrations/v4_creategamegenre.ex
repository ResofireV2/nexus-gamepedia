defmodule Gamepedia.Migrations.V4CreateGameGenre do
  use Ecto.Migration

  # Idempotent throughout.
  #
  # Nexus normally skips migrations already recorded in schema_migrations, so
  # this would run once. But force-uninstall deletes the schema_migrations
  # rows while deliberately leaving the tables in place, so a reinstall
  # replays every migration against a database where the objects already
  # exist. The previous version of this migration then failed at
  # `create constraint(...)` and left the extension in migration_failed.
  #
  # The redundant NOT NULL check constraint that used to live here has been
  # dropped: game_id is already declared null: false, and the composite
  # primary key below enforces non-nullity on both columns anyway.
  def change do
    create_if_not_exists table(:gamepedia_game_genre, primary_key: false) do
      add :game_id,  references(:gamepedia_games,  on_delete: :delete_all), null: false
      add :genre_id, references(:gamepedia_genres, on_delete: :delete_all), null: false
    end

    # Guarded so a replay against an existing table is a no-op rather than a
    # duplicate_object error.
    execute(
      """
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'gamepedia_game_genre_pkey'
        ) THEN
          ALTER TABLE gamepedia_game_genre ADD PRIMARY KEY (game_id, genre_id);
        END IF;
      END $$;
      """,
      """
      ALTER TABLE gamepedia_game_genre DROP CONSTRAINT IF EXISTS gamepedia_game_genre_pkey;
      """
    )

    create_if_not_exists index(:gamepedia_game_genre, [:genre_id])
  end
end
