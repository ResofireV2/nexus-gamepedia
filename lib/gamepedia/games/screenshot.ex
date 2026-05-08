defmodule Gamepedia.Games.Screenshot do
  use Ecto.Schema
  import Ecto.Changeset

  schema "gamepedia_screenshots" do
    field :igdb_image_id, :string
    field :url,           :string
    field :order,         :integer, default: 0

    belongs_to :game, Gamepedia.Games.Game

    timestamps(type: :utc_datetime)
  end

  def changeset(screenshot, attrs) do
    screenshot
    |> cast(attrs, [:game_id, :igdb_image_id, :url, :order])
    |> validate_required([:game_id, :igdb_image_id, :url])
  end
end
