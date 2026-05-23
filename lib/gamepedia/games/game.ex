defmodule Gamepedia.Games.Game do
  use Ecto.Schema
  import Ecto.Changeset

  schema "gamepedia_games" do
    field :igdb_id,            :integer
    field :name,               :string
    field :slug,               :string
    field :summary,            :string
    field :cover_image_url,    :string
    field :trailer_youtube_id, :string
    field :developer,          :string
    field :publisher,          :string
    field :first_release_date, :integer
    field :raw_igdb_data,      :map

    many_to_many :genres, Gamepedia.Genres.Genre,
      join_through: "gamepedia_game_genre",
      join_keys: [game_id: :id, genre_id: :id],
      on_replace: :delete

    has_many :screenshots, Gamepedia.Games.Screenshot, foreign_key: :game_id

    timestamps(type: :utc_datetime)
  end

  def changeset(game, attrs) do
    game
    |> cast(attrs, [:igdb_id, :name, :slug, :summary, :cover_image_url,
                    :trailer_youtube_id, :developer, :publisher,
                    :first_release_date, :raw_igdb_data])
    |> validate_required([:igdb_id, :name, :slug])
    |> unique_constraint(:igdb_id)
    |> unique_constraint(:slug)
  end
end
