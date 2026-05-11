defmodule Gamepedia.Genres.Genre do
  use Ecto.Schema
  import Ecto.Changeset

  schema "gamepedia_genres" do
    field :igdb_id, :integer
    field :name,    :string
    field :slug,    :string

    many_to_many :games, Gamepedia.Games.Game,
      join_through: "gamepedia_game_genre",
      join_keys: [genre_id: :id, game_id: :id],
      on_replace: :delete

    timestamps(type: :utc_datetime)
  end

  def changeset(genre, attrs) do
    genre
    |> cast(attrs, [:igdb_id, :name, :slug])
    |> validate_required([:name, :slug])
    |> unique_constraint(:slug)
    |> unique_constraint(:igdb_id)
  end
end
