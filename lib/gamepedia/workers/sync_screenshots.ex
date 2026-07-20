defmodule Gamepedia.Workers.SyncScreenshots do
  @moduledoc """
  Downloads IGDB screenshots for a game, converts them to WebP, and records
  them in `gamepedia_screenshots`.

  ## Why this is a job and not inline work

  Importing a game previously did all of this inside `Repo.transaction/1`:
  up to eight HTTP GETs at a 30 second receive timeout each, plus a libvips
  decode and WebP encode per image. That held a pooled database connection
  open for the entire duration — far past Ecto's 15 second default
  transaction timeout — so screenshot-heavy imports failed, and every import
  occupied a connection other requests needed.

  The game row is now committed first and screenshots are filled in here,
  asynchronously. The game is immediately usable; screenshots appear when
  the job finishes.

  ## Namespacing

  This module must stay under the `Gamepedia.` namespace. Nexus cancels an
  extension's pending Oban jobs on uninstall by matching the worker column
  against the extension's root module, so a worker defined outside that
  namespace would survive uninstall and then crash trying to call a module
  that is no longer loaded.

  ## Idempotency

  `mode: "replace"` deletes existing screenshot rows and files for the game
  before re-downloading — used by refresh. `mode: "fill"` skips any image
  already recorded, so a retried job does not duplicate work. Oban retries
  up to `max_attempts` on failure; a partially completed run resumes rather
  than starting over.
  """

  use Oban.Worker, queue: :extensions, max_attempts: 3

  require Logger

  import Ecto.Query

  alias Nexus.Repo
  alias Gamepedia.Games.Screenshot
  alias Nexus.Extensions.Storage

  @screenshot_subdir "screenshots"
  @download_timeout 30_000

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"game_id" => game_id} = args}) do
    mode = Map.get(args, "mode", "fill")

    case Gamepedia.Games.get_game(game_id) do
      nil ->
        # Game was deleted between enqueue and execution. Nothing to do, and
        # nothing to retry — discard rather than fail.
        Logger.info("Gamepedia: SyncScreenshots skipped, game #{game_id} no longer exists")
        :ok

      game ->
        if mode == "replace", do: purge_existing(game.id)
        sync(game, args["screenshots"] || [])
    end
  end

  # ---------------------------------------------------------------------------
  # Sync
  # ---------------------------------------------------------------------------

  defp sync(game, screenshots) do
    existing =
      from(s in Screenshot, where: s.game_id == ^game.id, select: s.igdb_image_id)
      |> Repo.all()
      |> MapSet.new()

    Enum.each(screenshots, fn s ->
      image_id = s["igdb_image_id"]

      unless is_nil(image_id) or MapSet.member?(existing, image_id) do
        {local_path, webp_path} = download_and_convert(image_id, s["url"])

        %Screenshot{}
        |> Screenshot.changeset(%{
          game_id: game.id,
          igdb_image_id: image_id,
          url: s["url"],
          local_path: local_path,
          webp_path: webp_path,
          order: s["order"] || 0
        })
        |> Repo.insert()
        |> case do
          {:ok, _} ->
            :ok

          {:error, changeset} ->
            # A unique-violation here means a concurrent job already inserted
            # this image. That is a benign race, not a reason to fail the job.
            Logger.warning(
              "Gamepedia: could not record screenshot #{image_id} for game #{game.id}: " <>
                inspect(changeset.errors)
            )
        end
      end
    end)

    :ok
  end

  # Download the IGDB screenshot at full resolution (t_1080p), save as jpg,
  # then convert to webp. Returns {local_rel_path, webp_rel_path}, or
  # {nil, nil} on failure so the UI falls back to the original IGDB URL.
  defp download_and_convert(image_id, igdb_url) when is_binary(igdb_url) do
    full_url = String.replace(igdb_url, "t_screenshot_big", "t_1080p")
    filename = "#{image_id}.jpg"
    webp_name = "#{image_id}.webp"

    :ok = Storage.ensure_dir("gamepedia", @screenshot_subdir)
    abs_jpg = Storage.path("gamepedia", "#{@screenshot_subdir}/#{filename}")
    abs_webp = Storage.path("gamepedia", "#{@screenshot_subdir}/#{webp_name}")

    with {:ok, %{status: 200, body: body}} <- Req.get(full_url, receive_timeout: @download_timeout),
         :ok <- File.write(abs_jpg, body),
         {:ok, image} <- Image.open(abs_jpg),
         {:ok, {image, _}} <- Image.autorotate(image),
         {:ok, _} <- Image.write(image, abs_webp, quality: 85) do
      {filename, webp_name}
    else
      err ->
        Logger.warning("Gamepedia: failed to download/convert screenshot #{image_id}: #{inspect(err)}")
        {nil, nil}
    end
  end

  defp download_and_convert(_image_id, _url), do: {nil, nil}

  # ---------------------------------------------------------------------------
  # Purge (refresh path)
  # ---------------------------------------------------------------------------

  @doc """
  Deletes screenshot rows and their files for a game.

  Files are removed outside any enclosing transaction: file deletion cannot
  be rolled back, so doing it transactionally risked losing images while the
  database was restored to a state that still referenced them.

  Public because the game-delete path needs the same cleanup.
  """
  def purge_existing(game_id) do
    rows = Repo.all(from s in Screenshot, where: s.game_id == ^game_id)

    Enum.each(rows, fn s ->
      if s.local_path,
        do: File.rm(Storage.path("gamepedia", "#{@screenshot_subdir}/#{s.local_path}"))

      if s.webp_path,
        do: File.rm(Storage.path("gamepedia", "#{@screenshot_subdir}/#{s.webp_path}"))
    end)

    Repo.delete_all(from s in Screenshot, where: s.game_id == ^game_id)
    :ok
  end

  @doc """
  Enqueues a screenshot sync for a game.

  `screenshots` is the list of maps produced by `Gamepedia.Igdb.map_to_schema/1`
  (keys `:igdb_image_id`, `:url`, `:order`); they are normalized to string
  keys here because Oban args round-trip through JSON.
  """
  def enqueue(game_id, screenshots, mode \\ "fill") do
    %{
      "game_id" => game_id,
      "mode" => mode,
      "screenshots" =>
        Enum.map(screenshots, fn s ->
          %{
            "igdb_image_id" => s[:igdb_image_id] || s["igdb_image_id"],
            "url" => s[:url] || s["url"],
            "order" => s[:order] || s["order"] || 0
          }
        end)
    }
    |> __MODULE__.new()
    |> Oban.insert()
  end
end
