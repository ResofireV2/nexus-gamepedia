defmodule Gamepedia.Migrations.V20260510000001AddLocalPathsToScreenshots do
  use Ecto.Migration

  def change do
    alter table(:gamepedia_screenshots) do
      add :local_path, :string
      add :webp_path,  :string
    end
  end
end
