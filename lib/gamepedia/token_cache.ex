defmodule Gamepedia.TokenCache do
  @moduledoc """
  Owns the ETS table that caches Gamepedia's Twitch/IGDB OAuth token.

  ## Why this process exists

  An ETS table is destroyed when the process that created it exits. The
  previous implementation called `:ets.new/2` lazily from inside
  `Gamepedia.Igdb.get_token/2`, which runs in whatever process is handling
  the current request — a short-lived Phoenix request process. The table
  therefore died with every request, and the very next IGDB call found an
  empty cache and performed a full Twitch OAuth round-trip. The cache never
  cached anything.

  This GenServer is started under Nexus's extension supervisor via
  `Gamepedia.child_specs/0`, so it lives for as long as the extension is
  loaded and the table survives with it. The table is created in `init/1`,
  before any request can reach it.

  This mirrors `Nexus.SettingsCache` in core, which solves the same problem
  for site settings.

  ## Concurrency

  The table is `:public` so request processes read and write directly
  without a GenServer round-trip — this process exists only to own the
  table, not to serialize access. Concurrent token writes are benign: two
  processes racing to refresh an expired token both write a valid token,
  and last-write-wins is correct either way.
  """

  use GenServer

  @table :gamepedia_igdb_token

  # ---------------------------------------------------------------------------
  # Supervision
  # ---------------------------------------------------------------------------

  def child_spec(_opts) do
    %{
      id: __MODULE__,
      start: {__MODULE__, :start_link, [[]]},
      type: :worker,
      restart: :permanent
    }
  end

  def start_link(_opts \\ []) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  @impl true
  def init(_) do
    # read_concurrency: token reads vastly outnumber writes (one write per
    # ~60 days of token lifetime, reads on every IGDB call).
    :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])
    {:ok, %{}}
  end

  # ---------------------------------------------------------------------------
  # Public API
  # ---------------------------------------------------------------------------

  @doc """
  Fetches a cached token for `key`, returning `{:ok, token}` when a live,
  unexpired entry exists and `:miss` otherwise.

  Returns `:miss` rather than raising when the table is absent, so callers
  degrade to a fresh fetch if this process has crashed and not yet been
  restarted by the supervisor.
  """
  @spec fetch(String.t()) :: {:ok, String.t()} | :miss
  def fetch(key) do
    case :ets.lookup(@table, key) do
      [{^key, token, expires_at}] ->
        if System.system_time(:second) < expires_at, do: {:ok, token}, else: :miss

      [] ->
        :miss
    end
  rescue
    ArgumentError -> :miss
  end

  @doc """
  Stores `token` under `key`, expiring at the absolute unix second
  `expires_at`. Returns `:ok` even when the table is unavailable — a failed
  cache write should never fail the surrounding IGDB request.
  """
  @spec put(String.t(), String.t(), integer()) :: :ok
  def put(key, token, expires_at) do
    :ets.insert(@table, {key, token, expires_at})
    :ok
  rescue
    ArgumentError -> :ok
  end

  @doc """
  Drops all cached tokens. Called when IGDB credentials change so a stale
  token issued for the previous client_id is not reused.
  """
  @spec clear() :: :ok
  def clear do
    :ets.delete_all_objects(@table)
    :ok
  rescue
    ArgumentError -> :ok
  end
end
