defmodule Gamepedia.Settings do
  @moduledoc """
  Reads Gamepedia's extension settings from Nexus.

  Settings are stored in `extensions.settings` (jsonb column) and edited from
  the admin panel's Settings/Digest/Post Sidebar tabs. They are the source of
  truth for IGDB credentials and digest/sidebar tuning values. Controllers
  reach for them via this helper rather than accepting credentials from the
  client, since the client should never need to know them.
  """

  @slug "gamepedia"

  @doc "Returns the full settings map, or `%{}` if the extension row is missing."
  def all do
    case Nexus.Extensions.get_extension_by_slug(@slug) do
      nil -> %{}
      ext -> ext.settings || %{}
    end
  end

  @doc "Returns `{client_id, client_secret}` from settings, or `nil` if either is missing/blank."
  def igdb_credentials do
    s = all()
    cid = s["igdb_client_id"]
    cs  = s["igdb_client_secret"]

    if is_binary(cid) and cid != "" and is_binary(cs) and cs != "" do
      {cid, cs}
    else
      nil
    end
  end

  @doc """
  Reads an integer setting with a fallback default.

  Each call hits the database, because `Nexus.Extensions.get_extension_by_slug/1`
  is an uncached `Repo.get_by`. When reading more than one key, fetch the map
  once with `all/0` and use `get_int/3` so a request does not pay for several
  round-trips to build one response.
  """
  def get_int(key, default) when is_binary(key) and is_integer(default) do
    get_int(all(), key, default)
  end

  @doc "Reads an integer setting from an already-fetched settings map."
  def get_int(settings, key, default)
      when is_map(settings) and is_binary(key) and is_integer(default) do
    case settings[key] do
      v when is_integer(v) -> v
      v when is_binary(v) ->
        case Integer.parse(v) do
          {i, _} -> i
          _      -> default
        end
      _ -> default
    end
  end
end
