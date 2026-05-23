defmodule Gamepedia.Migrations.V20260523000001CreateGenres do
  use Ecto.Migration

  def change do
    create_if_not_exists table(:gamepedia_genres) do
      add :igdb_id, :integer
      add :name,    :string,  null: false
      add :slug,    :string,  null: false

      timestamps(type: :utc_datetime)
    end

    create_if_not_exists unique_index(:gamepedia_genres, [:igdb_id])
    create_if_not_exists unique_index(:gamepedia_genres, [:slug])
  end
end
