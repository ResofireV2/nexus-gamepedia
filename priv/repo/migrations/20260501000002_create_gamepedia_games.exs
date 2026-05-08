defmodule Gamepedia.Repo.Migrations.CreateGamepediaGames do
  use Ecto.Migration

  def change do
    create table(:gamepedia_games) do
      add :igdb_id,            :integer,  null: false
      add :name,               :string,   null: false
      add :slug,               :string,   null: false
      add :summary,            :text
      add :cover_image_url,    :string
      add :trailer_youtube_id, :string
      add :developer,          :string
      add :publisher,          :string
      add :first_release_date, :integer
      add :raw_igdb_data,      :map

      timestamps(type: :utc_datetime)
    end

    create unique_index(:gamepedia_games, [:igdb_id])
    create unique_index(:gamepedia_games, [:slug])
  end
end
