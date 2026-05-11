defmodule Gamepedia.Migrations.V006CreateAwards do
  use Ecto.Migration

  def change do
    create table(:gamepedia_awards) do
      add :game_id, references(:gamepedia_games, on_delete: :delete_all), null: false
      add :year,    :string, size: 4, null: false
      add :title,   :string, size: 100, null: false

      timestamps(type: :utc_datetime)
    end

    create index(:gamepedia_awards, [:game_id])
  end
end
