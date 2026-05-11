defmodule Gamepedia.Migrations.V009AddLocalPathsToScreenshots do
  use Ecto.Migration

  def change do
    alter table(:gamepedia_screenshots) do
      add :local_path, :string
      add :webp_path,  :string
    end
  end
end
