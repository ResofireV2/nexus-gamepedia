defmodule Gamepedia.Igdb do
  @moduledoc """
  IGDB API client.

  Handles Twitch OAuth token acquisition and caching, game search,
  and full game data fetch. Uses the Req HTTP client already in mix.exs.

  Credentials are passed in at call time from extension settings
  (stored in Nexus and forwarded on webhook events). This means
  no credentials need to be baked into the service config.
  """

  @twitch_token_url "https://id.twitch.tv/oauth2/token"
  @igdb_base_url    "https://api.igdb.com/v4"
  @image_url        "https://images.igdb.com/igdb/image/upload/t_{size}/{id}.jpg"
  @token_cache_key  "gamepedia:igdb_token"
  @token_table      :gamepedia_igdb_token

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

  @doc """
  Ensures the ETS token cache table exists. Called by the Application supervisor.
  """
  def init_cache do
    :ets.new(@token_table, [:named_table, :public, :set])
  rescue
    ArgumentError -> :ok  # table already exists
  end

  defp get_token(client_id, client_secret) do
    cache_key = "#{@token_cache_key}:#{client_id}"

    case :ets.lookup(@token_table, cache_key) do
      [{^cache_key, token, expires_at}] ->
        if System.system_time(:second) < expires_at do
          {:ok, token}
        else
          fetch_token(client_id, client_secret, cache_key)
        end

      [] ->
        fetch_token(client_id, client_secret, cache_key)
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

        :ets.insert(@token_table, {cache_key, token, expires_at})
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

    Enum.find_value(priorities, fn keyword ->
      Enum.find_value(videos, fn v ->
        name = String.downcase(v["name"] || "")
        if String.contains?(name, keyword), do: v["video_id"]
      end)
    end) || get_in(List.first(videos), ["video_id"])
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
