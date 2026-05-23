defmodule Gamepedia.Migrations.V20260523000001CreateGenres do
  use Ecto.Migration

  def change do
    create table(:gamepedia_genres) do
      add :igdb_id, :integer
      add :name,    :string,  null: false
      add :slug,    :string,  null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:gamepedia_genres, [:igdb_id])
    create unique_index(:gamepedia_genres, [:slug])
  end
end
