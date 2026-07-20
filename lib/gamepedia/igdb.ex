defmodule Gamepedia.Igdb do
  @moduledoc """
  IGDB API client.

  Handles Twitch OAuth token acquisition and caching, game search,
  and full game data fetch. Uses the Req HTTP client already in
  Nexus's dependency tree.

  Credentials are read from Gamepedia's extension settings
  (`Gamepedia.Settings.igdb_credentials/0`) by the controllers that
  call this module — they are never passed in from the client.
  """

  @twitch_token_url "https://id.twitch.tv/oauth2/token"
  @igdb_base_url    "https://api.igdb.com/v4"
  @image_url        "https://images.igdb.com/igdb/image/upload/t_{size}/{id}.jpg"
  @token_cache_key  "gamepedia:igdb_token"

  # ---------------------------------------------------------------------------
  # Public API
  # ---------------------------------------------------------------------------

  @doc """
  Search IGDB for games matching a query string.
  Returns a list of simplified game maps for the admin search panel.
  """
  def search_games(query, client_id, client_secret, limit \\ 25) do
    with {:ok, token} <- get_token(client_id, client_secret) do
      safe_query = String.replace(query, "\"", "\\\"")

      body = """
      search "#{safe_query}";
      fields id, name, cover.image_id, first_release_date,
             involved_companies.company.name, involved_companies.developer,
             involved_companies.publisher;
      limit #{limit};
      """

      case igdb_request("/games", body, token, client_id) do
        {:ok, results} -> {:ok, Enum.map(results, &map_to_search_result/1)}
        {:error, _} = err -> err
      end
    end
  end

  @doc """
  Fetch full details for a single game by its IGDB ID.
  Returns a fully-mapped map ready to be saved to the database.
  """
  def fetch_game(igdb_id, client_id, client_secret) do
    with {:ok, token} <- get_token(client_id, client_secret) do
      body = """
      fields id, name, summary,
             cover.image_id,
             screenshots.image_id,
             videos.video_id, videos.name,
             involved_companies.company.name,
             involved_companies.developer,
             involved_companies.publisher,
             first_release_date;
      where id = #{igdb_id};
      limit 1;
      """

      case igdb_request("/games", body, token, client_id) do
        {:ok, [game | _]} -> {:ok, map_to_schema(game)}
        {:ok, []}         -> {:error, :not_found}
        {:error, _} = err -> err
      end
    end
  end

  # ---------------------------------------------------------------------------
  # Token management — ETS-backed cache
  # ---------------------------------------------------------------------------

  defp get_token(client_id, client_secret) do
    # The cache table is owned by Gamepedia.TokenCache, a supervised process
    # started via child_specs/0. It used to be created lazily here with
    # :ets.new/2, which meant the request process owned it and the table was
    # destroyed the moment the response was sent — so every IGDB call paid for
    # a fresh Twitch OAuth round-trip.
    cache_key = "#{@token_cache_key}:#{client_id}"

    case Gamepedia.TokenCache.fetch(cache_key) do
      {:ok, token} -> {:ok, token}
      :miss        -> fetch_token(client_id, client_secret, cache_key)
    end
  end

  defp fetch_token(client_id, client_secret, cache_key) do
    case Req.post(@twitch_token_url,
           form: [
             client_id: client_id,
             client_secret: client_secret,
             grant_type: "client_credentials"
           ],
           receive_timeout: 10_000) do
      {:ok, %{status: 200, body: body}} ->
        token      = body["access_token"]
        expires_in = body["expires_in"] || 5_184_000
        expires_at = System.system_time(:second) + trunc(expires_in * 0.9)

        Gamepedia.TokenCache.put(cache_key, token, expires_at)
        {:ok, token}

      {:ok, %{status: status}} ->
        {:error, "Twitch token request failed with HTTP #{status}. Check your Client ID and Secret."}

      {:error, reason} ->
        {:error, "Twitch token request failed: #{inspect(reason)}"}
    end
  end

  # ---------------------------------------------------------------------------
  # IGDB HTTP request
  # ---------------------------------------------------------------------------

  defp igdb_request(endpoint, body, token, client_id) do
    url = @igdb_base_url <> endpoint

    case Req.post(url,
           body: String.trim(body),
           headers: [
             {"Client-ID", client_id},
             {"Authorization", "Bearer #{token}"},
             {"Accept", "application/json"},
             {"Content-Type", "text/plain"}
           ],
           receive_timeout: 10_000) do
      {:ok, %{status: 200, body: results}} when is_list(results) ->
        {:ok, results}

      {:ok, %{status: 200, body: body}} ->
        # Req may return raw binary if content-type wasn't detected
        case Jason.decode(body) do
          {:ok, results} when is_list(results) -> {:ok, results}
          _ -> {:ok, []}
        end

      {:ok, %{status: 401}} ->
        {:error, "IGDB authentication failed. Check your Client ID and Secret."}

      {:ok, %{status: status}} ->
        {:error, "IGDB returned HTTP #{status}"}

      {:error, reason} ->
        {:error, "IGDB request failed: #{inspect(reason)}"}
    end
  end

  # ---------------------------------------------------------------------------
  # Data mapping
  # ---------------------------------------------------------------------------

  defp map_to_search_result(game) do
    %{
      igdb_id:            game["id"],
      name:               game["name"] || "Unknown",
      cover_image_url:    build_image_url(get_in(game, ["cover", "image_id"]), "cover_big"),
      first_release_date: game["first_release_date"],
      release_year:       release_year(game["first_release_date"]),
      developer:          extract_company(game, "developer"),
      publisher:          extract_company(game, "publisher")
    }
  end

  def map_to_schema(game) do
    %{
      igdb_id:            game["id"],
      name:               game["name"] || "Unknown",
      summary:            game["summary"],
      cover_image_url:    build_image_url(get_in(game, ["cover", "image_id"]), "cover_big"),
      first_release_date: game["first_release_date"],
      developer:          extract_company(game, "developer"),
      publisher:          extract_company(game, "publisher"),
      trailer_youtube_id: extract_trailer_id(game["videos"] || []),
      screenshots:        extract_screenshots(game),
      raw_igdb_data:      game
    }
  end

  defp extract_company(game, role) do
    companies = game["involved_companies"] || []
    result = Enum.find(companies, fn c -> c[role] == true end)
    get_in(result, ["company", "name"])
  end

  defp extract_trailer_id([]), do: nil
  defp extract_trailer_id(videos) do
    priorities = ["trailer", "reveal"]

    # Collect all candidate video IDs in priority order
    candidates =
      Enum.flat_map(priorities, fn keyword ->
        Enum.filter(videos, fn v ->
          name = String.downcase(v["name"] || "")
          String.contains?(name, keyword)
        end)
      end)
      |> Enum.map(& &1["video_id"])
      |> Enum.uniq()

    # Fallback: any video if no priority match
    candidates = if candidates == [] do
      videos |> Enum.map(& &1["video_id"]) |> Enum.reject(&is_nil/1)
    else
      candidates
    end

    # Pick the first candidate that has a maxresdefault thumbnail available.
    # Falls back to the first candidate if none have it (client-side onError handles hqdefault).
    #
    # Capped at three probes. Each is a blocking HTTP HEAD on the import path,
    # and a game with a dozen videos previously serialised a dozen of them
    # before the import could return.
    candidates = Enum.take(candidates, 3)

    Enum.find(candidates, List.first(candidates), fn video_id ->
      url = "https://i.ytimg.com/vi/#{video_id}/maxresdefault.jpg"
      case Req.head(url, receive_timeout: 3_000) do
        {:ok, %{status: 200}} -> true
        _                     -> false
      end
    end)
  end

  defp extract_screenshots(game, limit \\ 8) do
    (game["screenshots"] || [])
    |> Enum.take(limit)
    |> Enum.with_index()
    |> Enum.flat_map(fn {s, idx} ->
      case s["image_id"] do
        nil -> []
        image_id ->
          [%{
            igdb_image_id: image_id,
            url:           build_image_url(image_id, "screenshot_big"),
            order:         idx
          }]
      end
    end)
  end

  defp build_image_url(nil, _size), do: nil
  defp build_image_url(image_id, size) do
    @image_url
    |> String.replace("{size}", size)
    |> String.replace("{id}", image_id)
  end

  defp release_year(nil), do: nil
  defp release_year(ts) do
    ts
    |> DateTime.from_unix!()
    |> Map.get(:year)
  end
end
