/**
 * Gamepedia — Nexus Extension Bundle v0.2.0
 *
 * Registers with NexusExtensions:
 *   registerToolbarButton   — gamepad button in post composer
 *   registerSlot            — post_footer (linked games), profile_sidebar (gamelog link)
 *   registerRoute           — /gamepedia/users/:username (gamelog page)
 *   registerAdminPanel      — Gamepedia admin (games, genres, stats)
 *   registerExploreItem     — Browse Games in left sidebar
 *   registerRightWidget     — Now Playing widget
 *   registerUserAction      — View Gamelog on user cards
 *   registerNotificationType — gamepedia_new_game
 */

(function () {
  "use strict";

  const React = window.React;
  const NE    = window.NexusExtensions;
  const NET   = window.NexusExtensionTemplates;
  const BASE  = "/api/v1/extensions/gamepedia/api";

  if (!React || !NE) {
    console.warn("[Gamepedia] React or NexusExtensions not available.");
    return;
  }

  const { useState, useEffect, useRef, useReducer } = React;
  const e = React.createElement;

  // ---------------------------------------------------------------------------
  // Auth token helper — reads from localStorage exactly as Nexus does
  // ---------------------------------------------------------------------------

  function authHeaders() {
    const token = localStorage.getItem("nexus_token");
    return {
      "Content-Type":  "application/json",
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
    };
  }

  function apiFetch(path, opts = {}) {
    return fetch(BASE + path, {
      ...opts,
      headers: { ...authHeaders(), ...(opts.headers || {}) },
      body:    opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(r => r.json());
  }

  // ---------------------------------------------------------------------------
  // GamePickerModal
  // Plain JS modal (no React) — opens from toolbar button onClick.
  // onSelect(game) is called with the chosen game object.
  // alreadyLinked is the current linkedGames array.
  // ---------------------------------------------------------------------------

  function openGamePickerModal(onSelect, alreadyLinked) {
    let searchTimer = null;

    const overlay = mk("div", { className: "gp-modal-overlay" });
    const modal   = mk("div", { className: "gp-modal" });

    const header  = mk("div", { className: "gp-modal-header" },
      mk("span", { className: "gp-modal-title" }, "Link a Game"),
      mkBtn("gp-modal-close", "✕", close)
    );

    const input   = mk("input", {
      className:   "gp-modal-search",
      type:        "text",
      placeholder: "Search your game library\u2026",
    });

    const results = mk("div", { className: "gp-modal-results" });

    modal.append(header, input, results);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    setTimeout(() => input.focus(), 50);

    overlay.addEventListener("mousedown", ev => { if (ev.target === overlay) close(); });
    document.addEventListener("keydown", onKey);

    function onKey(ev) { if (ev.key === "Escape") { close(); } }
    function close() { overlay.remove(); document.removeEventListener("keydown", onKey); }

    function render(games) {
      results.innerHTML = "";
      if (!games.length) {
        results.appendChild(mk("p", { className: "gp-modal-empty" }, "No games found."));
        return;
      }
      games.forEach(game => {
        const linked = alreadyLinked.some(g => g.id === game.id);
        const row    = mk("button", { className: "gp-result-row" + (linked ? " is-linked" : "") });
        if (game.cover_image_url) {
          const img = document.createElement("img");
          img.className = "gp-result-cover";
          img.src = game.cover_image_url;
          img.alt = game.name;
          row.appendChild(img);
        } else {
          row.appendChild(mk("div", { className: "gp-result-nocover" }, "\uD83C\uDFAE"));
        }
        const info = mk("div", { className: "gp-result-info" },
          mk("div", { className: "gp-result-name" }, game.name)
        );
        if (game.release_year) info.appendChild(mk("div", { className: "gp-result-year" }, String(game.release_year)));
        row.appendChild(info);
        if (linked) row.appendChild(mk("span", { className: "gp-result-linked" }, "\u2713 Linked"));
        row.addEventListener("mousedown", ev => {
          ev.preventDefault();
          if (!linked) { onSelect(game); close(); }
        });
        results.appendChild(row);
      });
    }

    function doSearch(q) {
      results.innerHTML = "<p class='gp-modal-loading'>Searching\u2026</p>";
      apiFetch(`/games?search=${encodeURIComponent(q)}&per_page=20`)
        .then(r => render(r.data || []))
        .catch(() => { results.innerHTML = "<p class='gp-modal-empty'>Search failed.</p>"; });
    }

    input.addEventListener("input", ev => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => doSearch(ev.target.value), 300);
    });

    doSearch("");
  }

  function mk(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === "className") node.className = v;
        else node.setAttribute(k, v);
      }
    }
    children.flat().forEach(c => {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function mkBtn(cls, text, onClick) {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }

  // ---------------------------------------------------------------------------
  // post_footer slot — GamepediaPostGames
  // Receives: { postId }
  // ---------------------------------------------------------------------------

  function GamepediaPostGames({ postId }) {
    const [games,   setGames]   = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      if (!postId) return;
      apiFetch(`/posts/${postId}/games`)
        .then(r => { setGames(r.data || []); setLoading(false); })
        .catch(() => setLoading(false));
    }, [postId]);

    if (loading || !games || games.length === 0) return null;

    return e("div", { className: "gp-post-games" },
      e("div", { className: "gp-post-games-label" },
        e("i", { className: "fa-solid fa-gamepad", style: { marginRight: 6 } }),
        "Linked Games"
      ),
      e("div", { className: "gp-post-games-list" },
        games.map(game =>
          e("a", {
            key:       game.id,
            className: "gp-game-card",
            href:      "#",
            onClick:   ev => {
              ev.preventDefault();
              if (window._nexusNavigate)
                window._nexusNavigate("ext-route",
                  NE.matchRoute(`/gamepedia/games/${game.slug}`) || {});
            },
          },
            game.cover_image_url
              ? e("img", { src: game.cover_image_url, alt: game.name, className: "gp-game-card-cover" })
              : e("div", { className: "gp-game-card-nocover" }, e("i", { className: "fa-solid fa-gamepad" })),
            e("div", { className: "gp-game-card-info" },
              e("div", { className: "gp-game-card-name" }, game.name),
              game.release_year ? e("div", { className: "gp-game-card-year" }, String(game.release_year)) : null,
              game.developer    ? e("div", { className: "gp-game-card-dev"  }, game.developer)            : null
            )
          )
        )
      )
    );
  }

  // ---------------------------------------------------------------------------
  // profile_sidebar slot — GamepediaGamelogLink
  // Receives: { username, currentUser, navigate }
  // ---------------------------------------------------------------------------

  function GamepediaGamelogLink({ username, navigate }) {
    function go(ev) {
      ev.preventDefault();
      if (window._nexusNavigate)
        window._nexusNavigate("ext-route",
          NE.matchRoute(`/gamepedia/users/${username}`) || {});
    }
    return e("a", {
      href:      `/gamepedia/users/${username}`,
      onClick:   go,
      className: "gp-profile-link",
    },
      e("i", { className: "fa-solid fa-bookmark", style: { marginRight: 6 } }),
      "Gamelog"
    );
  }

  // ---------------------------------------------------------------------------
  // Gamelog Page — /gamepedia/users/:username
  // Receives: { username, currentUser, navigate }
  // ---------------------------------------------------------------------------

  function GamelogPage({ username, currentUser, navigate }) {
    const currentUserId = currentUser?.id || null;

    const [data,        setData]        = useState(null);
    const [loading,     setLoading]     = useState(true);
    const [error,       setError]       = useState(null);
    const [page,        setPage]        = useState(1);
    const [sort,        setSort]        = useState("newest");
    const [genre,       setGenre]       = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [search,      setSearch]      = useState("");
    const [playingBusy, setPlayingBusy] = useState(false);
    const searchTimer = useRef(null);

    const isOwner = !!(currentUserId && data && currentUserId === data.user?.id);

    function load(p, s, g, q) {
      setLoading(true);
      const params = new URLSearchParams({ page: p, sort: s });
      if (g) params.set("genre", g);
      if (q) params.set("search", q);
      apiFetch(`/gamelog/${encodeURIComponent(username)}?${params}`)
        .then(r => { setData(r); setLoading(false); })
        .catch(() => { setError("Failed to load gamelog."); setLoading(false); });
    }

    useEffect(() => { load(1, sort, genre, search); }, [username]);

    function removeGame(game) {
      if (!currentUserId) return;
      apiFetch(`/gamelog/${game.id}`, { method: "DELETE", body: { user_id: currentUserId } })
        .then(() => load(page, sort, genre, search));
    }

    function markPlaying(game) {
      if (!currentUserId || playingBusy) return;
      setPlayingBusy(true);
      apiFetch(`/gamelog/${game.id}/playing`, { method: "POST", body: { user_id: currentUserId } })
        .then(() => { setPlayingBusy(false); load(page, sort, genre, search); })
        .catch(() => setPlayingBusy(false));
    }

    if (error) return e("div", { className: "gp-error" }, error);

    const stats  = data?.stats;
    const games  = data?.data    || [];
    const meta   = data?.meta    || {};
    const genres = data?.filters?.genres || [];

    return e("div", { className: "gp-gamelog-page" },

      // Stats bar
      stats && e("div", { className: "gp-gl-stats" },
        stats.playing && e("div", { className: "gp-gl-stats-playing" },
          e("span", { className: "gp-gl-stats-playing-label" }, "Currently playing"),
          e("span", { className: "gp-gl-stats-playing-name" }, stats.playing.name)
        ),
        e("div", { className: "gp-gl-stats-row" },
          e("div", { className: "gp-gl-stat" },
            e("div", { className: "gp-gl-stat-n" }, stats.total),
            e("div", { className: "gp-gl-stat-l" }, "games")
          ),
          e("div", { className: "gp-gl-stat" },
            e("div", { className: "gp-gl-stat-n" }, stats.added_this_month),
            e("div", { className: "gp-gl-stat-l" }, "this month")
          ),
          stats.top_genre && e("div", { className: "gp-gl-stat" },
            e("div", { className: "gp-gl-stat-n" }, stats.top_genre.name),
            e("div", { className: "gp-gl-stat-l" }, "top genre")
          ),
          stats.oldest && e("div", { className: "gp-gl-stat" },
            e("div", { className: "gp-gl-stat-n" }, stats.oldest.name),
            e("div", { className: "gp-gl-stat-l" }, `oldest \u00B7 ${stats.oldest.year}`)
          )
        )
      ),

      // Filters
      e("div", { className: "gp-gl-filters" },
        e("input", {
          className:   "gp-input",
          type:        "text",
          placeholder: "Search games\u2026",
          value:       searchInput,
          onChange:    ev => {
            setSearchInput(ev.target.value);
            clearTimeout(searchTimer.current);
            searchTimer.current = setTimeout(() => {
              setSearch(ev.target.value);
              setPage(1);
              load(1, sort, genre, ev.target.value);
            }, 400);
          },
        }),
        genres.length > 1 && e("select", {
          className: "gp-select",
          value:     genre,
          onChange:  ev => { setGenre(ev.target.value); setPage(1); load(1, sort, ev.target.value, search); },
        },
          e("option", { value: "" }, "All Genres"),
          genres.map(g => e("option", { key: g.id, value: g.slug }, g.name))
        ),
        e("select", {
          className: "gp-select",
          value:     sort,
          onChange:  ev => { setSort(ev.target.value); setPage(1); load(1, ev.target.value, genre, search); },
        },
          e("option", { value: "newest" }, "Date Added"),
          e("option", { value: "az"     }, "A \u2192 Z"),
          e("option", { value: "year"   }, "Release Year")
        )
      ),

      loading && e("div", { className: "gp-loading" },
        e("i", { className: "fa-solid fa-spinner fa-spin" }), " Loading\u2026"
      ),

      !loading && games.length === 0 && e("div", { className: "gp-empty" },
        "No games in this Gamelog yet."
      ),

      !loading && games.length > 0 && e("div", { className: "gp-grid" },
        games.map(game =>
          e("div", { key: game.id, className: "gp-gl-card" + (game.is_playing ? " is-playing" : "") },
            e("a", {
              href:      "#",
              className: "gp-gl-card-link",
              onClick:   ev => {
                ev.preventDefault();
                if (window._nexusNavigate)
                  window._nexusNavigate("ext-route",
                    NE.matchRoute(`/gamepedia/games/${game.slug}`) || {});
              },
            },
              game.cover_image_url
                ? e("img", { src: game.cover_image_url, alt: game.name, className: "gp-gl-card-cover" })
                : e("div", { className: "gp-gl-card-nocover" }, e("i", { className: "fa-solid fa-gamepad" })),
              e("div", { className: "gp-gl-card-info" },
                e("div", { className: "gp-gl-card-name" }, game.name),
                game.release_year && e("div", { className: "gp-gl-card-year" }, String(game.release_year)),
                game.is_playing   && e("div", { className: "gp-gl-playing-badge" }, "\u25B6 Playing")
              )
            ),
            isOwner && e("div", { className: "gp-gl-card-actions" },
              e("button", {
                className: "gp-gl-btn" + (game.is_playing ? " active" : ""),
                title:     game.is_playing ? "Unmark as playing" : "Mark as playing",
                disabled:  playingBusy,
                onClick:   ev => { ev.preventDefault(); markPlaying(game); },
              }, e("i", { className: "fa-solid fa-play" })),
              e("button", {
                className: "gp-gl-btn gp-gl-btn-remove",
                title:     "Remove from Gamelog",
                onClick:   ev => { ev.preventDefault(); removeGame(game); },
              }, e("i", { className: "fa-solid fa-times" }))
            )
          )
        )
      ),

      // Pagination
      !loading && meta.last_page > 1 && e("div", { className: "gp-pagination" },
        page > 1 && e("button", {
          className: "gp-btn",
          onClick:   () => { const p = page - 1; setPage(p); load(p, sort, genre, search); },
        }, e("i", { className: "fa-solid fa-chevron-left" }), " Previous"),
        e("span", { className: "gp-page-info" }, `Page ${page} of ${meta.last_page}`),
        page < meta.last_page && e("button", {
          className: "gp-btn",
          onClick:   () => { const p = page + 1; setPage(p); load(p, sort, genre, search); },
        }, "Next ", e("i", { className: "fa-solid fa-chevron-right" }))
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Now Playing right sidebar widget
  // Receives: { navigate, currentUser }
  // ---------------------------------------------------------------------------

  function NowPlayingWidget({ navigate, currentUser }) {
    const [game,    setGame]    = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      if (!currentUser?.username) { setLoading(false); return; }
      apiFetch(`/gamelog/${encodeURIComponent(currentUser.username)}?sort=newest&page=1`)
        .then(r => {
          const playing = (r.data || []).find(g => g.is_playing) || null;
          setGame(playing);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }, [currentUser?.username]);

    if (!currentUser) return null;
    if (loading) return e("div", { style: { textAlign: "center", padding: 12, color: "var(--t5)" } },
      e("i", { className: "fa-solid fa-spinner fa-spin" })
    );
    if (!game) return e("div", { style: { fontSize: 12, color: "var(--t4)", padding: "4px 0" } },
      "No game currently playing. Add one from your ",
      e("a", {
        href:    "#",
        style:   { color: "var(--ac)" },
        onClick: ev => {
          ev.preventDefault();
          if (window._nexusNavigate)
            window._nexusNavigate("ext-route",
              NE.matchRoute(`/gamepedia/users/${currentUser.username}`) || {});
        },
      }, "Gamelog"),
      "."
    );

    return e("div", {
      className: "gp-now-playing",
      style:     { cursor: "pointer" },
      onClick:   () => {
        if (window._nexusNavigate)
          window._nexusNavigate("ext-route",
            NE.matchRoute(`/gamepedia/games/${game.slug}`) || {});
      },
    },
      game.cover_image_url
        ? e("img", { src: game.cover_image_url, alt: game.name, className: "gp-now-playing-cover" })
        : e("div", { className: "gp-now-playing-nocover" }, e("i", { className: "fa-solid fa-gamepad" })),
      e("div", { className: "gp-now-playing-info" },
        e("div", { className: "gp-now-playing-label" },
          e("i", { className: "fa-solid fa-play", style: { fontSize: 9, marginRight: 5, color: "var(--ac)" } }),
          "Now Playing"
        ),
        e("div", { className: "gp-now-playing-name" }, game.name)
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Admin Panel — registered via registerAdminPanel
  // Tabs: Games, Genres, Stats
  // Settings tab is handled by Nexus natively via TabbedPanel
  // ---------------------------------------------------------------------------

  function GamepediaAdminPanel() {
    const [tab,          setTab]         = useState("games");

    // Games tab state
    const [games,        setGames]       = useState([]);
    const [gamesLoading, setGamesLoading]= useState(true);
    const [totalGames,   setTotalGames]  = useState(0);
    const [hasMore,      setHasMore]     = useState(false);
    const [currentPage,  setCurrentPage] = useState(1);
    const [searchInput,  setSearchInput] = useState("");
    const [search,       setSearch]      = useState("");
    const [genreFilter,  setGenreFilter] = useState("");
    const [sort,         setSort]        = useState("newest");
    const [filterGenres, setFilterGenres]= useState([]);
    const [deleting,     setDeleting]    = useState({});
    const [refreshing,   setRefreshing]  = useState({});
    const [showAddModal, setShowAddModal]= useState(false);
    const [editGenreGame,setEditGenreGame]=useState(null);
    const searchTimer = useRef(null);

    // Genres tab state
    const [genres,       setGenres]      = useState([]);
    const [genresLoading,setGenresLoading]=useState(true);
    const [newGenre,     setNewGenre]    = useState("");
    const [creatingGenre,setCreatingGenre]=useState(false);

    // Stats tab state
    const [stats,        setStats]       = useState(null);
    const [statsLoading, setStatsLoading]= useState(false);

    // Credentials — from Nexus extension settings via API
    const [creds,        setCreds]       = useState({ client_id: "", client_secret: "" });

    useEffect(() => {
      // Load saved IGDB credentials from extension settings
      fetch("/api/v1/admin/extensions/gamepedia", { headers: authHeaders() })
        .then(r => r.json())
        .then(d => {
          const s = d.extension?.settings || {};
          setCreds({
            client_id:     s.igdb_client_id     || "",
            client_secret: s.igdb_client_secret || "",
          });
        })
        .catch(() => {});
      loadGames(1);
      loadGenres();
    }, []);

    function loadGames(page, append) {
      setGamesLoading(true);
      if (!append) setGames([]);
      const params = new URLSearchParams({ page: page || 1, sort });
      if (search)      params.set("search", search);
      if (genreFilter) params.set("genre", genreFilter);
      apiFetch(`/admin/games?${params}`)
        .then(r => {
          setGamesLoading(false);
          setGames(prev => append ? [...prev, ...(r.data || [])] : (r.data || []));
          setTotalGames(r.meta?.total || 0);
          setHasMore(r.meta?.has_more || false);
          setCurrentPage(r.meta?.current_page || 1);
          setFilterGenres(r.filters?.genres || []);
        })
        .catch(() => setGamesLoading(false));
    }

    function loadGenres() {
      setGenresLoading(true);
      apiFetch("/admin/genres")
        .then(r => { setGenres(r.data || []); setGenresLoading(false); })
        .catch(() => setGenresLoading(false));
    }

    function loadStats() {
      if (statsLoading) return;
      setStatsLoading(true);
      apiFetch("/admin/stats")
        .then(r => { setStats(r.data || null); setStatsLoading(false); })
        .catch(() => setStatsLoading(false));
    }

    function deleteGame(game) {
      if (!confirm(`Delete "${game.name}"? This cannot be undone.`)) return;
      setDeleting(p => ({ ...p, [game.id]: true }));
      apiFetch(`/admin/games/${game.id}`, { method: "DELETE" })
        .then(() => { setGames(p => p.filter(g => g.id !== game.id)); setTotalGames(p => p - 1); })
        .catch(() => alert("Failed to delete game."))
        .finally(() => setDeleting(p => ({ ...p, [game.id]: false })));
    }

    function refreshGame(game) {
      if (!creds.client_id) { alert("IGDB credentials not saved. Go to Settings \u2192 Extensions \u2192 Gamepedia."); return; }
      setRefreshing(p => ({ ...p, [game.id]: true }));
      apiFetch(`/admin/games/${game.id}/refresh`, {
        method: "POST",
        body:   { client_id: creds.client_id, client_secret: creds.client_secret },
      })
        .then(r => {
          if (r.data) setGames(p => p.map(g => g.id === game.id ? { ...g, ...r.data } : g));
        })
        .catch(() => alert(`Failed to refresh ${game.name}.`))
        .finally(() => setRefreshing(p => ({ ...p, [game.id]: false })));
    }

    function createGenre() {
      const name = newGenre.trim();
      if (!name) return;
      setCreatingGenre(true);
      apiFetch("/admin/genres", { method: "POST", body: { name } })
        .then(r => {
          if (r.data) {
            setGenres(p => [...p, r.data].sort((a, b) => a.name.localeCompare(b.name)));
            setNewGenre("");
          }
        })
        .catch(() => alert("Failed to create genre."))
        .finally(() => setCreatingGenre(false));
    }

    function deleteGenre(genre) {
      if (!confirm(`Delete genre "${genre.name}"?`)) return;
      apiFetch(`/admin/genres/${genre.id}`, { method: "DELETE" })
        .then(() => setGenres(p => p.filter(g => g.id !== genre.id)))
        .catch(() => alert("Failed to delete genre."));
    }

    return e("div", { className: "gp-admin" },

      // Tabs
      e("div", { className: "gp-admin-tabs" },
        ["games", "genres", "stats"].map(t =>
          e("button", {
            key:       t,
            className: "gp-admin-tab" + (tab === t ? " active" : ""),
            onClick:   () => { setTab(t); if (t === "stats" && !stats) loadStats(); },
          },
            t === "games"  ? "\uD83C\uDFAE Games"  :
            t === "genres" ? "\uD83C\uDFF7 Genres" : "\uD83D\uDCCA Stats"
          )
        )
      ),

      // ── Games Tab ──────────────────────────────────────────────────────────
      tab === "games" && e("div", null,
        e("div", { className: "gp-admin-toolbar" },
          e("div", { className: "gp-admin-filters" },
            e("input", {
              className:   "gp-input",
              type:        "text",
              placeholder: "Search games\u2026",
              value:       searchInput,
              onChange:    ev => {
                setSearchInput(ev.target.value);
                clearTimeout(searchTimer.current);
                searchTimer.current = setTimeout(() => {
                  setSearch(ev.target.value);
                  loadGames(1);
                }, 400);
              },
            }),
            e("select", {
              className: "gp-select",
              value:     genreFilter,
              onChange:  ev => { setGenreFilter(ev.target.value); loadGames(1); },
            },
              e("option", { value: "" }, "All Genres"),
              filterGenres.map(g => e("option", { key: g.id, value: g.slug }, g.name))
            ),
            e("select", {
              className: "gp-select",
              value:     sort,
              onChange:  ev => { setSort(ev.target.value); loadGames(1); },
            },
              e("option", { value: "newest" }, "Newest Added"),
              e("option", { value: "oldest" }, "Oldest Added"),
              e("option", { value: "az"     }, "A \u2192 Z"),
              e("option", { value: "za"     }, "Z \u2192 A")
            )
          ),
          e("button", {
            className: "gp-btn-primary",
            onClick:   () => {
              if (!creds.client_id) {
                alert("Save your IGDB credentials first: Extensions \u2192 Gamepedia \u2192 IGDB Credentials.");
                return;
              }
              setShowAddModal(true);
            },
          }, "+ Add Game")
        ),

        !gamesLoading && e("p", { className: "gp-admin-count" },
          `${totalGames} game${totalGames !== 1 ? "s" : ""}`
        ),

        gamesLoading && games.length === 0 && e("div", { className: "gp-loading" },
          e("i", { className: "fa-solid fa-spinner fa-spin" }), " Loading\u2026"
        ),

        !gamesLoading && games.length === 0 && e("p", { className: "gp-empty" },
          "No games yet. Click \u201C+ Add Game\u201D to import from IGDB."
        ),

        games.length > 0 && e("div", { className: "gp-admin-grid" },
          games.map(game =>
            e("div", { key: game.id, className: "gp-admin-card" },
              game.cover_image_url
                ? e("img", { className: "gp-admin-card-cover", src: game.cover_image_url, alt: game.name })
                : e("div", { className: "gp-admin-card-nocover" }, e("i", { className: "fa-solid fa-gamepad" })),
              e("div", { className: "gp-admin-card-info" },
                e("div", { className: "gp-admin-card-name" }, game.name),
                game.release_year && e("div", { className: "gp-admin-card-year" }, String(game.release_year)),
                game.genres?.length > 0 && e("div", { className: "gp-admin-card-genres" },
                  game.genres.map(g => e("span", { key: g.id, className: "gp-genre-tag" }, g.name))
                )
              ),
              e("div", { className: "gp-admin-card-actions" },
                e("button", { className: "gp-admin-btn", title: "Edit genres", onClick: () => setEditGenreGame(game) },
                  e("i", { className: "fa-solid fa-tags" })
                ),
                e("button", {
                  className: "gp-admin-btn",
                  title:     "Refresh from IGDB",
                  disabled:  !!refreshing[game.id],
                  onClick:   () => refreshGame(game),
                }, e("i", { className: refreshing[game.id] ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-sync" })),
                e("button", {
                  className: "gp-admin-btn gp-admin-btn-danger",
                  title:     "Delete",
                  disabled:  !!deleting[game.id],
                  onClick:   () => deleteGame(game),
                }, e("i", { className: deleting[game.id] ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-trash" }))
              )
            )
          )
        ),

        hasMore && e("div", { style: { textAlign: "center", padding: "16px 0" } },
          e("button", { className: "gp-btn", onClick: () => loadGames(currentPage + 1, true) }, "Load more")
        )
      ),

      // ── Genres Tab ─────────────────────────────────────────────────────────
      tab === "genres" && e("div", null,
        e("div", { className: "gp-genre-create" },
          e("input", {
            className:   "gp-input",
            type:        "text",
            placeholder: "New genre name\u2026",
            value:       newGenre,
            onChange:    ev => setNewGenre(ev.target.value),
            onKeyDown:   ev => { if (ev.key === "Enter") createGenre(); },
          }),
          e("button", {
            className: "gp-btn-primary",
            disabled:  !newGenre.trim() || creatingGenre,
            onClick:   createGenre,
          }, creatingGenre ? "Adding\u2026" : "+ Add Genre")
        ),
        genresLoading && e("div", { className: "gp-loading" },
          e("i", { className: "fa-solid fa-spinner fa-spin" }), " Loading\u2026"
        ),
        !genresLoading && genres.length === 0 && e("p", { className: "gp-empty" }, "No genres yet."),
        !genresLoading && genres.length > 0 && e("div", { className: "gp-genre-list" },
          genres.map(g =>
            e("div", { key: g.id, className: "gp-genre-row" },
              e("span", { className: "gp-genre-row-name" }, g.name),
              e("button", {
                className: "gp-admin-btn gp-admin-btn-danger",
                title:     "Delete",
                onClick:   () => deleteGenre(g),
              }, e("i", { className: "fa-solid fa-trash" }))
            )
          )
        )
      ),

      // ── Stats Tab ──────────────────────────────────────────────────────────
      tab === "stats" && e("div", null,
        statsLoading && e("div", { className: "gp-loading" },
          e("i", { className: "fa-solid fa-spinner fa-spin" }), " Loading\u2026"
        ),
        !statsLoading && !stats && e("p", { className: "gp-empty" }, "No data yet."),
        !statsLoading && stats && e("div", null,
          e("div", { className: "gp-stats-grid" },
            [
              { label: "Total Games",     value: stats.total_games },
              { label: "Screenshots",     value: `${stats.total_screenshots} (~${stats.estimated_disk_mb} MB)` },
              { label: "Gamelog Entries", value: stats.total_gamelogs },
              { label: "No Genre",        value: stats.games_no_genre, warn: stats.games_no_genre > 0 },
              { label: "No Cover",        value: stats.games_no_cover, warn: stats.games_no_cover > 0 },
            ].map(s =>
              e("div", { key: s.label, className: "gp-stat-card" + (s.warn ? " warn" : "") },
                e("div", { className: "gp-stat-value" }, String(s.value)),
                e("div", { className: "gp-stat-label" }, s.label)
              )
            )
          ),
          stats.top_gamelog_games?.length > 0 && e("div", { className: "gp-stats-top" },
            e("h4", { className: "gp-stats-top-title" }, "Most Gamelog\u2019d"),
            e("ol", { className: "gp-stats-top-list" },
              stats.top_gamelog_games.map(g =>
                e("li", { key: g.id },
                  e("span", null, g.name),
                  e("span", { className: "gp-stats-count" }, `${g.gamelog_count} users`)
                )
              )
            )
          ),
          e("button", {
            className: "gp-btn",
            style:     { marginTop: 12 },
            onClick:   () => { setStats(null); loadStats(); },
          }, e("i", { className: "fa-solid fa-sync", style: { marginRight: 6 } }), "Refresh")
        )
      ),

      // ── Add Game Modal ─────────────────────────────────────────────────────
      showAddModal && e(AddGameModal, {
        creds,
        onGameAdded: () => loadGames(1),
        onClose:     () => setShowAddModal(false),
      }),

      // ── Edit Genres Modal ──────────────────────────────────────────────────
      editGenreGame && e(EditGenresModal, {
        game:    editGenreGame,
        genres,
        onSaved: updatedGame => {
          setGames(p => p.map(g => g.id === updatedGame.id ? updatedGame : g));
          setEditGenreGame(null);
        },
        onClose: () => setEditGenreGame(null),
      })
    );
  }

  // ---------------------------------------------------------------------------
  // AddGameModal
  // ---------------------------------------------------------------------------

  function AddGameModal({ creds, onGameAdded, onClose }) {
    const [query,   setQuery]   = useState("");
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error,   setError]   = useState(null);
    const [adding,  setAdding]  = useState({});
    const [added,   setAdded]   = useState({});
    const searchTimer = useRef(null);

    function doSearch(q) {
      if (!q || q.length < 2) { setResults([]); return; }
      setLoading(true); setError(null);
      fetch(`/api/v1/extensions/gamepedia/api/games/search?q=${encodeURIComponent(q)}&client_id=${encodeURIComponent(creds.client_id)}&client_secret=${encodeURIComponent(creds.client_secret)}`)
        .then(r => r.json())
        .then(r => { setLoading(false); setResults(r.data || []); if (r.error) setError(r.error); })
        .catch(() => { setLoading(false); setError("Search failed."); });
    }

    function addGame(game) {
      setAdding(p => ({ ...p, [game.igdb_id]: true }));
      fetch("/api/v1/extensions/gamepedia/api/admin/games/import", {
        method:  "POST",
        headers: authHeaders(),
        body:    JSON.stringify({ igdb_id: game.igdb_id, client_id: creds.client_id, client_secret: creds.client_secret }),
      })
        .then(r => r.json())
        .then(r => {
          if (r.error) { setError(r.error); return; }
          setAdded(p => ({ ...p, [game.igdb_id]: true }));
          onGameAdded();
        })
        .catch(() => setError("Failed to add game."))
        .finally(() => setAdding(p => ({ ...p, [game.igdb_id]: false })));
    }

    return e("div", {
      className: "gp-modal-overlay",
      onMouseDown: ev => { if (ev.target === ev.currentTarget) onClose(); },
    },
      e("div", { className: "gp-modal" },
        e("div", { className: "gp-modal-header" },
          e("span", { className: "gp-modal-title" }, "Add Game from IGDB"),
          e("button", { className: "gp-modal-close", onClick: onClose }, "\u2715")
        ),
        e("input", {
          className:   "gp-modal-search",
          type:        "text",
          placeholder: "Search IGDB\u2026",
          value:       query,
          autoFocus:   true,
          onChange:    ev => {
            setQuery(ev.target.value);
            clearTimeout(searchTimer.current);
            searchTimer.current = setTimeout(() => doSearch(ev.target.value), 500);
          },
        }),
        error && e("div", { className: "gp-modal-error" }, error),
        loading && e("p", { className: "gp-modal-loading" },
          e("i", { className: "fa-solid fa-spinner fa-spin" }), " Searching IGDB\u2026"
        ),
        e("div", { className: "gp-modal-results" },
          results.length === 0 && !loading && query.length >= 2 &&
            e("p", { className: "gp-modal-empty" }, "No results."),
          results.map(game =>
            e("div", { key: game.igdb_id, className: "gp-import-row" },
              game.cover_image_url
                ? e("img", { className: "gp-import-cover", src: game.cover_image_url, alt: game.name })
                : e("div", { className: "gp-import-nocover" }, "\uD83C\uDFAE"),
              e("div", { className: "gp-import-info" },
                e("strong", null, game.name),
                game.release_year && e("span", { className: "gp-import-year" }, ` (${game.release_year})`),
                game.developer && e("div", null, e("small", null, game.developer))
              ),
              e("div", { className: "gp-import-action" },
                added[game.igdb_id]
                  ? e("span", { className: "gp-import-done" }, e("i", { className: "fa-solid fa-check" }), " Added")
                  : e("button", {
                      className: "gp-btn-primary",
                      disabled:  !!adding[game.igdb_id],
                      onClick:   () => addGame(game),
                    }, adding[game.igdb_id] ? "Adding\u2026" : "Add Game")
              )
            )
          )
        )
      )
    );
  }

  // ---------------------------------------------------------------------------
  // EditGenresModal
  // ---------------------------------------------------------------------------

  function EditGenresModal({ game, genres, onSaved, onClose }) {
    const [selected, setSelected] = useState(new Set((game.genres || []).map(g => g.id)));
    const [saving,   setSaving]   = useState(false);

    function save() {
      setSaving(true);
      fetch(`/api/v1/extensions/gamepedia/api/admin/games/${game.id}/genres`, {
        method:  "POST",
        headers: authHeaders(),
        body:    JSON.stringify({ genre_ids: Array.from(selected) }),
      })
        .then(() => {
          const updatedGenres = genres.filter(g => selected.has(g.id));
          onSaved({ ...game, genres: updatedGenres });
        })
        .catch(() => alert("Failed to save genres."))
        .finally(() => setSaving(false));
    }

    return e("div", {
      className: "gp-modal-overlay",
      onMouseDown: ev => { if (ev.target === ev.currentTarget) onClose(); },
    },
      e("div", { className: "gp-modal gp-modal-sm" },
        e("div", { className: "gp-modal-header" },
          e("span", { className: "gp-modal-title" }, `Genres \u2014 ${game.name}`),
          e("button", { className: "gp-modal-close", onClick: onClose }, "\u2715")
        ),
        e("div", { className: "gp-genre-checklist" },
          genres.length === 0 && e("p", { className: "gp-modal-empty" },
            "No genres yet. Create some in the Genres tab."
          ),
          genres.map(g =>
            e("label", { key: g.id, className: "gp-genre-check-row" },
              e("input", {
                type:     "checkbox",
                checked:  selected.has(g.id),
                onChange: ev => {
                  const next = new Set(selected);
                  ev.target.checked ? next.add(g.id) : next.delete(g.id);
                  setSelected(next);
                },
              }),
              " ", g.name
            )
          )
        ),
        e("div", { className: "gp-modal-footer" },
          e("button", { className: "gp-btn-primary", disabled: saving, onClick: save },
            saving ? "Saving\u2026" : "Save Genres"
          )
        )
      )
    );
  }

  // ---------------------------------------------------------------------------
  // CSS
  // ---------------------------------------------------------------------------

  const style = document.createElement("style");
  style.textContent = `
/* ── Shared ── */
.gp-loading{text-align:center;padding:32px 0;color:var(--t5);font-size:13px;}
.gp-empty{text-align:center;padding:32px 0;color:var(--t4);font-size:13px;}
.gp-error{color:var(--red);font-size:13px;padding:12px 0;}
.gp-input{padding:7px 10px;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;color:var(--t1);font-size:13px;outline:none;font-family:inherit;}
.gp-input::placeholder{color:var(--t4);}
.gp-input:focus{border-color:var(--ac-border);}
.gp-select{padding:7px 10px;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;color:var(--t1);font-size:13px;outline:none;font-family:inherit;}
.gp-btn{background:rgba(255,255,255,.08);border:0.5px solid rgba(255,255,255,.12);border-radius:8px;color:var(--t2);cursor:pointer;font-size:13px;padding:7px 16px;font-family:inherit;transition:background .12s;}
.gp-btn:hover{background:rgba(255,255,255,.13);}
.gp-btn-primary{background:var(--ac);border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:13px;font-weight:500;padding:7px 16px;font-family:inherit;transition:opacity .12s;}
.gp-btn-primary:hover{opacity:.88;}
.gp-btn-primary:disabled{opacity:.4;cursor:default;}
.gp-pagination{display:flex;align-items:center;justify-content:center;gap:12px;padding:16px 0;}
.gp-page-info{font-size:12px;color:var(--t4);}

/* ── Modal ── */
.gp-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9000;padding:16px;}
.gp-modal{background:#1a1928;border:0.5px solid rgba(255,255,255,.12);border-radius:16px;width:100%;max-width:480px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.6);}
.gp-modal-sm{max-width:360px;}
.gp-modal-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:0.5px solid rgba(255,255,255,.08);flex-shrink:0;}
.gp-modal-title{font-size:14px;font-weight:600;color:var(--t1);}
.gp-modal-close{background:none;border:none;color:var(--t4);font-size:18px;cursor:pointer;line-height:1;padding:0;font-family:inherit;}
.gp-modal-close:hover{color:var(--t1);}
.gp-modal-search{margin:12px 16px;padding:9px 12px;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;color:var(--t1);font-size:13px;outline:none;width:calc(100% - 32px);box-sizing:border-box;font-family:inherit;}
.gp-modal-search::placeholder{color:var(--t4);}
.gp-modal-search:focus{border-color:var(--ac-border);}
.gp-modal-results{overflow-y:auto;flex:1;padding:0 8px 12px;}
.gp-modal-loading,.gp-modal-empty{font-size:13px;color:var(--t4);text-align:center;padding:20px;}
.gp-modal-error{font-size:12px;color:var(--red);padding:4px 16px;}
.gp-modal-footer{padding:12px 16px;border-top:0.5px solid rgba(255,255,255,.08);display:flex;justify-content:flex-end;flex-shrink:0;}

/* ── Game picker search results ── */
.gp-result-row{display:flex;align-items:center;gap:10px;width:100%;background:none;border:none;border-radius:10px;padding:8px 10px;cursor:pointer;text-align:left;transition:background .12s;font-family:inherit;}
.gp-result-row:hover{background:rgba(255,255,255,.06);}
.gp-result-row.is-linked{opacity:.5;cursor:default;}
.gp-result-cover{width:32px;height:44px;object-fit:cover;border-radius:4px;flex-shrink:0;}
.gp-result-nocover{width:32px;height:44px;background:rgba(255,255,255,.06);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
.gp-result-info{flex:1;min-width:0;}
.gp-result-name{font-size:13px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.gp-result-year{font-size:11px;color:var(--t4);margin-top:2px;}
.gp-result-linked{font-size:11px;color:var(--ac);flex-shrink:0;}

/* ── Composer chips ── */
.comp-game-chips{display:flex;flex-wrap:wrap;gap:6px;padding:6px 0;}
.comp-game-chip{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,0.06);border:0.5px solid var(--b2);border-radius:20px;padding:4px 10px 4px 6px;font-size:12px;color:var(--t2);}
.comp-game-chip img{width:20px;height:28px;object-fit:cover;border-radius:3px;}
.comp-game-chip button{background:none;border:none;color:var(--t4);cursor:pointer;font-size:11px;padding:0 0 0 2px;line-height:1;font-family:inherit;}
.comp-game-chip button:hover{color:var(--t1);}

/* ── Post footer linked games ── */
.gp-post-games{padding:12px 0 6px;border-top:0.5px solid rgba(255,255,255,.06);margin-top:8px;}
.gp-post-games-label{font-size:11px;font-weight:500;color:var(--t4);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;display:flex;align-items:center;}
.gp-post-games-list{display:flex;flex-wrap:wrap;gap:10px;}
.gp-game-card{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:10px;padding:8px 12px 8px 8px;text-decoration:none;transition:background .12s,border-color .12s;}
.gp-game-card:hover{background:var(--ac-bg);border-color:var(--ac-border);}
.gp-game-card-cover{width:36px;height:48px;object-fit:cover;border-radius:5px;flex-shrink:0;}
.gp-game-card-nocover{width:36px;height:48px;background:rgba(255,255,255,.06);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;color:var(--t4);}
.gp-game-card-info{min-width:0;}
.gp-game-card-name{font-size:13px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;}
.gp-game-card-year{font-size:11px;color:var(--t4);margin-top:1px;}
.gp-game-card-dev{font-size:11px;color:var(--t5);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;}

/* ── Profile sidebar link ── */
.gp-profile-link{display:flex;align-items:center;padding:6px 10px;font-size:13px;color:var(--t2);text-decoration:none;border-radius:8px;transition:background .12s;}
.gp-profile-link:hover{background:rgba(255,255,255,.06);color:var(--t1);}

/* ── Gamelog page ── */
.gp-gamelog-page{padding:16px 0;}
.gp-gl-stats{background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:12px;padding:14px 16px;margin-bottom:16px;}
.gp-gl-stats-playing{display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-bottom:10px;border-bottom:0.5px solid rgba(255,255,255,.06);}
.gp-gl-stats-playing-label{font-size:11px;color:var(--ac);font-weight:500;text-transform:uppercase;letter-spacing:.06em;}
.gp-gl-stats-playing-name{font-size:13px;color:var(--t1);font-weight:500;}
.gp-gl-stats-row{display:flex;gap:16px;flex-wrap:wrap;}
.gp-gl-stat{min-width:70px;}
.gp-gl-stat-n{font-size:15px;font-weight:600;color:var(--t1);}
.gp-gl-stat-l{font-size:11px;color:var(--t4);margin-top:1px;}
.gp-gl-filters{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;}
.gp-gl-filters .gp-input{flex:1;min-width:120px;}
.gp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;}
.gp-gl-card{position:relative;border-radius:10px;overflow:hidden;background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);transition:border-color .12s;}
.gp-gl-card:hover{border-color:var(--ac-border);}
.gp-gl-card.is-playing{border-color:var(--ac);}
.gp-gl-card-link{display:block;text-decoration:none;}
.gp-gl-card-cover{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;}
.gp-gl-card-nocover{width:100%;aspect-ratio:3/4;display:flex;align-items:center;justify-content:center;font-size:28px;color:var(--t5);}
.gp-gl-card-info{padding:8px;}
.gp-gl-card-name{font-size:12px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.gp-gl-card-year{font-size:11px;color:var(--t4);margin-top:2px;}
.gp-gl-playing-badge{font-size:10px;color:var(--ac);margin-top:3px;font-weight:500;}
.gp-gl-card-actions{display:flex;gap:4px;padding:0 6px 6px;}
.gp-gl-btn{background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:6px;color:var(--t3);cursor:pointer;flex:1;font-size:11px;padding:5px;font-family:inherit;transition:background .12s,color .12s;}
.gp-gl-btn:hover{background:rgba(255,255,255,.1);color:var(--t1);}
.gp-gl-btn.active{background:var(--ac-bg);border-color:var(--ac-border);color:var(--ac);}
.gp-gl-btn:disabled{opacity:.4;cursor:default;}
.gp-gl-btn-remove:hover{background:rgba(248,113,113,.1);border-color:rgba(248,113,113,.3);color:var(--red);}

/* ── Now Playing widget ── */
.gp-now-playing{display:flex;align-items:center;gap:10px;padding:4px 0;}
.gp-now-playing-cover{width:36px;height:48px;object-fit:cover;border-radius:5px;flex-shrink:0;}
.gp-now-playing-nocover{width:36px;height:48px;background:rgba(255,255,255,.06);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--t4);}
.gp-now-playing-info{min-width:0;}
.gp-now-playing-label{font-size:10px;color:var(--t4);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;}
.gp-now-playing-name{font-size:13px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

/* ── Admin panel ── */
.gp-admin{padding:16px 0;}
.gp-admin-tabs{display:flex;gap:4px;margin-bottom:16px;border-bottom:0.5px solid var(--b1);padding-bottom:0;}
.gp-admin-tab{background:none;border:none;border-bottom:2px solid transparent;color:var(--t3);cursor:pointer;font-size:13px;padding:8px 14px 10px;font-family:inherit;transition:color .12s,border-color .12s;margin-bottom:-1px;}
.gp-admin-tab:hover{color:var(--t1);}
.gp-admin-tab.active{color:var(--ac);border-bottom-color:var(--ac);}
.gp-admin-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;flex-wrap:wrap;}
.gp-admin-filters{display:flex;gap:6px;flex-wrap:wrap;flex:1;}
.gp-admin-filters .gp-input{flex:1;min-width:120px;}
.gp-admin-count{font-size:12px;color:var(--t4);margin-bottom:10px;}
.gp-admin-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;}
.gp-admin-card{background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden;}
.gp-admin-card-cover{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;}
.gp-admin-card-nocover{width:100%;aspect-ratio:3/4;display:flex;align-items:center;justify-content:center;font-size:28px;color:var(--t5);}
.gp-admin-card-info{padding:8px 8px 4px;}
.gp-admin-card-name{font-size:12px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.gp-admin-card-year{font-size:11px;color:var(--t4);margin-top:1px;}
.gp-admin-card-genres{display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;}
.gp-genre-tag{font-size:10px;background:var(--ac-bg);color:var(--ac-text);border-radius:4px;padding:2px 5px;}
.gp-admin-card-actions{display:flex;gap:4px;padding:4px 6px 6px;}
.gp-admin-btn{background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:6px;color:var(--t3);cursor:pointer;flex:1;font-size:11px;padding:5px;font-family:inherit;transition:background .12s,color .12s;}
.gp-admin-btn:hover{background:rgba(255,255,255,.1);color:var(--t1);}
.gp-admin-btn:disabled{opacity:.4;cursor:default;}
.gp-admin-btn-danger:hover{background:rgba(248,113,113,.1);border-color:rgba(248,113,113,.3);color:var(--red);}
.gp-genre-create{display:flex;gap:8px;margin-bottom:14px;}
.gp-genre-create .gp-input{flex:1;}
.gp-genre-list{display:flex;flex-direction:column;gap:6px;}
.gp-genre-row{display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:8px;padding:8px 12px;}
.gp-genre-row-name{font-size:13px;color:var(--t1);}
.gp-stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:20px;}
.gp-stat-card{background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:10px;padding:14px;}
.gp-stat-card.warn{border-color:rgba(251,191,36,.3);background:rgba(251,191,36,.05);}
.gp-stat-value{font-size:20px;font-weight:600;color:var(--t1);margin-bottom:4px;}
.gp-stat-label{font-size:11px;color:var(--t4);}
.gp-stats-top{margin-bottom:16px;}
.gp-stats-top-title{font-size:13px;color:var(--t2);margin-bottom:8px;font-weight:500;}
.gp-stats-top-list{padding-left:18px;}
.gp-stats-top-list li{display:flex;justify-content:space-between;font-size:13px;color:var(--t2);padding:3px 0;}
.gp-stats-count{color:var(--t4);font-size:12px;}
.gp-import-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;transition:background .12s;}
.gp-import-row:hover{background:rgba(255,255,255,.04);}
.gp-import-cover{width:32px;height:44px;object-fit:cover;border-radius:4px;flex-shrink:0;}
.gp-import-nocover{width:32px;height:44px;background:rgba(255,255,255,.06);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
.gp-import-info{flex:1;min-width:0;}
.gp-import-year{font-size:12px;color:var(--t4);}
.gp-import-action{flex-shrink:0;}
.gp-import-done{font-size:12px;color:var(--green);}
.gp-genre-checklist{padding:8px 16px;max-height:300px;overflow-y:auto;}
.gp-genre-check-row{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;color:var(--t2);cursor:pointer;}
`;
  document.head.appendChild(style);

  // ---------------------------------------------------------------------------
  // Registrations
  // ---------------------------------------------------------------------------

  // Composer toolbar button (posts only — Nexus wires this to ComposePage, not reply box)
  NE.registerToolbarButton({
    icon:  "fa-solid fa-gamepad",
    tip:   "Link a game",
    color: "var(--ac)",
    onClick(linkedGames, setLinkedGames) {
      openGamePickerModal(
        game => setLinkedGames(prev =>
          prev.some(g => g.id === game.id) ? prev : [...prev, game]
        ),
        linkedGames
      );
    },
  }, 50);

  // post_footer slot — shows linked games below post content
  NE.registerSlot("post_footer", GamepediaPostGames, 50);

  // profile_sidebar slot — Gamelog link on user profiles
  NE.registerSlot("profile_sidebar", GamepediaGamelogLink, 50);

  // SPA route — gamelog page
  NE.registerRoute("/gamepedia/users/:username", GamelogPage, { title: "Gamelog" });

  // Explore sidebar item — Browse Games
  NE.registerExploreItem({
    id:       "gamepedia-browse",
    label:    "Browse Games",
    icon:     "fa-gamepad",
    page:     "ext-route",
    props:    NE.matchRoute("/gamepedia/users/") || {},
    authOnly: false,
    priority: 60,
  });

  // Right sidebar widget — Now Playing
  NE.registerRightWidget({
    id:        "gamepedia-now-playing",
    label:     "Now Playing",
    component: NowPlayingWidget,
    priority:  60,
  });

  // User card action — View Gamelog
  NE.registerUserAction({
    id:       "gamepedia-view-gamelog",
    label:    "View Gamelog",
    icon:     "fa-bookmark",
    authOnly: false,
    priority: 50,
    onClick({ user, navigate, closeCard }) {
      closeCard();
      if (window._nexusNavigate)
        window._nexusNavigate("ext-route",
          NE.matchRoute(`/gamepedia/users/${user.username}`) || {});
    },
  });

  // Admin panel — Games, Genres, Stats
  NE.registerAdminPanel("gamepedia", {
    label:     "Gamepedia",
    icon:      "fa-gamepad",
    component: GamepediaAdminPanel,
  });

  // Notification type — new game added to library
  NE.registerNotificationType("gamepedia_new_game", {
    icon:      "fa-gamepad",
    iconColor: "var(--ac)",
    renderBody(n) {
      return React.createElement(React.Fragment, null,
        React.createElement("strong", { style: { color: "var(--t1)" } },
          n.data?.game_name || "A game"),
        React.createElement("span", { style: { color: "var(--t3)" } },
          " was added to the Gamepedia library")
      );
    },
    onClick({ n, navigate }) {
      if (window._nexusNavigate && n.data?.game_slug)
        window._nexusNavigate("ext-route",
          NE.matchRoute(`/gamepedia/games/${n.data.game_slug}`) || {});
    },
  });

})();
