defmodule Gamepedia.Migrations.V20260523000003CreateScreenshots do
  use Ecto.Migration

  def change do
    create_if_not_exists table(:gamepedia_screenshots) do
      add :game_id,       references(:gamepedia_games, on_delete: :delete_all), null: false
      add :igdb_image_id, :string,  null: false
      add :url,           :string,  null: false
      add :order,         :integer, default: 0

      timestamps(type: :utc_datetime)
    end

    create_if_not_exists index(:gamepedia_screenshots, [:game_id])
  end
end
