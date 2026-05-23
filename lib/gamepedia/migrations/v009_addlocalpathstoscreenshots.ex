defmodule Gamepedia.Migrations.V20260523000009AddLocalPathsToScreenshots do
  use Ecto.Migration

  def change do
    alter table(:gamepedia_screenshots) do
      add_if_not_exists :local_path, :string
      add_if_not_exists :webp_path,  :string
    end
  end
end
