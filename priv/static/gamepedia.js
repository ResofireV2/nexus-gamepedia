/**
 * Gamepedia — Nexus Extension Bundle v0.2.0
 *
 * Registers with NexusExtensions:
 *   registerToolbarButton   — gamepad button in post composer
 *   registerSlot            — post_sidebar (game card in post right sidebar), profile_tab (gamelog)
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
  const BASE  = "/ext/gamepedia/api";

  if (!React || !NE) {
    console.warn("[Gamepedia] React or NexusExtensions not available.");
    return;
  }

  // Patch history.pushState to strip non-serializable values (functions, RegExp)
  // so ext-route _match objects with React components don't throw DataCloneError.
  (function() {
    const orig = window.history.pushState.bind(window.history);
    function sanitize(obj) {
      if (obj === null) return obj;
      if (typeof obj === "function" || obj instanceof RegExp) return undefined;
      if (typeof obj !== "object") return obj;
      if (Array.isArray(obj)) return obj.map(sanitize).filter(v => v !== undefined);
      const out = {};
      for (const k of Object.keys(obj)) {
        const v = sanitize(obj[k]);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    window.history.pushState = function(state, title, url) {
      try {
        JSON.stringify(state);
        return orig(state, title, url);
      } catch(e) {
        return orig(sanitize(state), title, url);
      }
    };
  })();

  // Patch NE.matchRoute to always return the live component from registered routes.
  // This ensures ExtensionRoutePage always gets the component even when pushState
  // has stripped it from the history state (which happens on mobile and hard refresh).
  (function() {
    const origMatch = NE.matchRoute.bind(NE);
    NE.matchRoute = function(pathname) {
      const result = origMatch(pathname);
      if (result && !result.component) {
        // Re-find the component from the live route registry
        const live = NE._routes.find(r => r.regex.test(pathname));
        if (live?.component) result.component = live.component;
      }
      return result;
    };
  })();

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
          const nc1 = mk("div", { className: "gp-result-nocover" }); nc1.innerHTML = '<i class="fa-solid fa-gamepad"></i>'; row.appendChild(nc1);
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
  // post_sidebar slot — PostSidebarGameCard
  // Renders the Option A cover-led card in the post right sidebar.
  // Receives: { postId, currentUser, navigate }
  // ---------------------------------------------------------------------------

  function PostSidebarGameCard({ postId, currentUser, navigate }) {
    const [games,      setGames]      = useState([]);
    const [gameDetails,setGameDetails]= useState({});
    const [gamelogs,   setGamelogs]   = useState({});
    const [logBusy,    setLogBusy]    = useState({});
    const [activeIdx,  setActiveIdx]  = useState(0);
    const [progress,   setProgress]   = useState(0);
    const timerRef  = useRef(null);
    const startRef  = useRef(null);
    const rafRef    = useRef(null);

    // Read slideshow interval from settings (stored on window by admin panel)
    const interval  = (window._gpSlideshowSeconds || 5) * 1000;

    useEffect(() => {
      if (!postId) return;
      setGames([]); setGameDetails({}); setGamelogs({}); setActiveIdx(0); setProgress(0);
      apiFetch(`/posts/${postId}/games`)
        .then(r => {
          const list = r.data || [];
          setGames(list);
          list.forEach(g => {
            apiFetch(`/games/${g.slug}`)
              .then(gr => { if (gr.data) setGameDetails(p => ({ ...p, [g.id]: gr.data })); })
              .catch(() => setGameDetails(p => ({ ...p, [g.id]: g })));
          });
          if (currentUser?.id && list.length > 0) {
            apiFetch(`/gamelog/${currentUser.id}`)
              .then(gr => {
                const logMap = {};
                (gr.data || []).forEach(x => { logMap[x.id] = true; });
                setGamelogs(logMap);
              })
              .catch(() => {});
          }
        })
        .catch(() => {});
    }, [postId]);

    // Slideshow timer with progress bar
    useEffect(() => {
      if (games.length <= 1) return;
      const tick = () => {
        const elapsed = Date.now() - startRef.current;
        const pct = Math.min(elapsed / interval, 1);
        setProgress(pct);
        if (pct < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          setActiveIdx(i => (i + 1) % games.length);
          setProgress(0);
          startRef.current = Date.now();
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      startRef.current = Date.now();
      rafRef.current = requestAnimationFrame(tick);
      return () => { cancelAnimationFrame(rafRef.current); };
    }, [games.length, activeIdx === 0 ? 0 : 1]);

    function goTo(idx) {
      cancelAnimationFrame(rafRef.current);
      setActiveIdx(idx);
      setProgress(0);
      startRef.current = Date.now();
      if (games.length > 1) {
        const tick = () => {
          const elapsed = Date.now() - startRef.current;
          const pct = Math.min(elapsed / interval, 1);
          setProgress(pct);
          if (pct < 1) { rafRef.current = requestAnimationFrame(tick); }
          else {
            setActiveIdx(i => (i + 1) % games.length);
            setProgress(0);
            startRef.current = Date.now();
            rafRef.current = requestAnimationFrame(tick);
          }
        };
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    if (games.length === 0) return null;
    const stub = games[activeIdx] || games[0];
    const game = gameDetails[stub.id] || stub;
    const inGamelog = !!gamelogs[game.id];
    const awards = game.awards || [];

    function toggleGamelog() {
      if (!currentUser || !game) return;
      setLogBusy(p => ({ ...p, [game.id]: true }));
      if (inGamelog) {
        apiFetch(`/gamelog/${game.id}`, { method: "DELETE" })
          .then(() => setGamelogs(p => ({ ...p, [game.id]: false })))
          .finally(() => setLogBusy(p => ({ ...p, [game.id]: false })));
      } else {
        apiFetch("/gamelog", { method: "POST", body: { game_id: game.id } })
          .then(() => setGamelogs(p => ({ ...p, [game.id]: true })))
          .finally(() => setLogBusy(p => ({ ...p, [game.id]: false })));
      }
    }

    function goToGame() {
      if (!game) return;
      if (window._nexusNavigate)
        window._nexusNavigate("ext-route",
          { _match: NE.matchRoute(`/ext/gamepedia/games/${game.slug}`), slug: game.slug });
    }

    return e("div", { className: "gp-psb" },
      e("div", { className: "gp-rw-label" },
        games.length > 1 ? `linked games (${activeIdx + 1}/${games.length})` : "linked game"
      ),

      // Cover art
      e("div", { className: "gp-psb-cover-wrap", onClick: goToGame },
        game.cover_image_url
          ? e("img", { src: game.cover_image_url, alt: game.name, className: "gp-psb-cover-img" })
          : e("div", { className: "gp-psb-cover-empty" }, e("i", { className: "fa-solid fa-gamepad" })),
        e("div", { className: "gp-psb-overlay" }),
        e("div", { className: "gp-psb-cover-bottom" },
          game.genres?.length > 0 && e("div", { className: "gp-psb-genres" },
            game.genres.slice(0, 2).map(g => e("span", { key: g.id, className: "gp-psb-genre-pill" }, g.name))
          ),
          e("div", { className: "gp-psb-name" }, game.name),
          e("div", { className: "gp-psb-sub" },
            [game.developer, game.publisher, game.release_year].filter(Boolean).map(String).slice(0, 2).join(" · ")
          )
        )
      ),

      // Slideshow progress bar + dots (only when multiple games)
      games.length > 1 && e("div", { className: "gp-psb-slideshow" },
        e("div", { className: "gp-psb-progress-bar" },
          e("div", { className: "gp-psb-progress-fill", style: { width: (progress * 100) + "%" } })
        ),
        e("div", { className: "gp-psb-dots" },
          games.map((_, i) =>
            e("div", {
              key:       i,
              className: "gp-psb-dot" + (i === activeIdx ? " active" : ""),
              onClick:   () => goTo(i),
            })
          )
        )
      ),

      // Awards
      awards.length > 0 && e("div", { className: "gp-psb-awards" },
        awards.slice(0, 2).map(a =>
          e("div", { key: a.id, className: "gp-psb-award" },
            e("i", { className: "fa-solid fa-trophy", style: { fontSize: 9, marginRight: 4 } }),
            a.title,
            e("span", { className: "gp-psb-award-year" }, a.year)
          )
        )
      ),

      // Stats row
      e("div", { className: "gp-psb-stats" },
        e("div", { className: "gp-psb-stat" },
          e("div", { className: "gp-psb-stat-n" },
            game.rating_avg
              ? e("span", null, e("i", { className: "fa-solid fa-star", style: { fontSize: 10, marginRight: 2, color: "#a78bfa" } }), game.rating_avg.toFixed(1))
              : e("span", { style: { fontSize: 10 } }, "—")
          ),
          e("div", { className: "gp-psb-stat-l" }, "rating")
        ),
        e("div", { className: "gp-psb-stat" },
          e("div", { className: "gp-psb-stat-n" }, game.gamelog_count ?? "—"),
          e("div", { className: "gp-psb-stat-l" }, "gamelogs")
        ),
        e("div", { className: "gp-psb-stat" },
          e("div", { className: "gp-psb-stat-n" }, game.thread_count ?? "—"),
          e("div", { className: "gp-psb-stat-l" }, "threads")
        )
      ),

      e("div", { className: "gp-psb-btn gp-psb-btn-view", onClick: goToGame },
        "View in Gamepedia ",
        e("i", { className: "fa-solid fa-arrow-right", style: { fontSize: 10 } })
      ),
      currentUser && e("div", {
        className: "gp-psb-btn " + (inGamelog ? "gp-psb-btn-added" : "gp-psb-btn-log"),
        onClick:   logBusy[game.id] ? undefined : toggleGamelog,
        style:     logBusy[game.id] ? { opacity: .5 } : {},
      },
        inGamelog
          ? e("span", null, e("i", { className: "fa-solid fa-check", style: { marginRight: 5 } }), "In your Gamelog")
          : e("span", null, e("i", { className: "fa-regular fa-bookmark", style: { marginRight: 5 } }), "Add to Gamelog")
      )
    );
  }

  // ---------------------------------------------------------------------------
  // profile_sidebar slot — GamepediaGamelogLink
  // Receives: { username, currentUser, navigate }
  // ---------------------------------------------------------------------------

  function GamepediaGamelogLink({ username, currentUser, navigate }) {
    // Navigate to the profile owner's gamelog using their user context
    // The profile slot passes username; we navigate to gamelog by user_id
    // which is resolved via the currentUser if viewing own profile
    function go(ev) {
      ev.preventDefault();
      if (window._nexusNavigate)
        window._nexusNavigate("ext-route",
          { _match: NE.matchRoute(`/ext/gamepedia/gamelog/${currentUser?.id || ""}`), user_id: currentUser?.id });
    }
    return e("a", {
      href:      "#",
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

  function GamelogPage({ user_id, currentUser, navigate }) {
    const currentUserId = currentUser?.id || null;
    // Support both user_id param (from route) and currentUser fallback
    const targetUserId = user_id || currentUserId;

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

    const isOwner = !!(currentUserId && data && data.is_owner);

    function load(p, s, g, q) {
      if (!targetUserId) { setError("No user specified."); setLoading(false); return; }
      setLoading(true);
      const params = new URLSearchParams({ page: p, sort: s });
      if (g) params.set("genre", g);
      if (q) params.set("search", q);
      apiFetch(`/gamelog/${targetUserId}?${params}`)
        .then(r => { setData(r); setLoading(false); })
        .catch(() => { setError("Failed to load gamelog."); setLoading(false); });
    }

    useEffect(() => { load(1, sort, genre, search); }, [targetUserId]);

    function removeGame(game) {
      if (!currentUserId) return;
      apiFetch(`/gamelog/${game.id}`, { method: "DELETE" })
        .then(() => load(page, sort, genre, search));
    }

    function markPlaying(game) {
      if (!currentUserId || playingBusy) return;
      setPlayingBusy(true);
      apiFetch(`/gamelog/${game.id}/playing`, { method: "POST", body: {} })
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
          e("i", { className: "fa-solid fa-play", style: { fontSize: 10 } }),
          e("span", { className: "gp-gl-stats-playing-label" }, "Currently playing"),
          e("span", { className: "gp-gl-stats-playing-name" }, stats.playing.name)
        ),
        e("div", { className: "gp-gl-stat-grid" },
          e("div", { className: "gp-gl-stat-card" },
            e("div", { className: "gp-gl-stat-icon", style: { background: "rgba(139,92,246,.12)", color: "var(--ac)" } },
              e("i", { className: "fa-solid fa-gamepad", style: { fontSize: 13 } })
            ),
            e("div", { className: "gp-gl-stat-n" }, stats.total),
            e("div", { className: "gp-gl-stat-l" }, "Games")
          ),
          e("div", { className: "gp-gl-stat-card" },
            e("div", { className: "gp-gl-stat-icon", style: { background: "rgba(52,211,153,.12)", color: "#34d399" } },
              e("i", { className: "fa-solid fa-calendar", style: { fontSize: 13 } })
            ),
            e("div", { className: "gp-gl-stat-n" }, stats.added_this_month),
            e("div", { className: "gp-gl-stat-l" }, "This month")
          ),
          e("div", { className: "gp-gl-stat-card" },
            e("div", { className: "gp-gl-stat-icon", style: { background: "rgba(96,165,250,.12)", color: "#60a5fa" } },
              e("i", { className: "fa-solid fa-tags", style: { fontSize: 13 } })
            ),
            e("div", { className: "gp-gl-stat-n" }, stats.top_genre ? stats.top_genre.name : "—"),
            e("div", { className: "gp-gl-stat-l" }, "Top genre")
          ),
          e("div", { className: "gp-gl-stat-card" },
            e("div", { className: "gp-gl-stat-icon", style: { background: "rgba(251,191,36,.12)", color: "#fbbf24" } },
              e("i", { className: "fa-solid fa-clock-rotate-left", style: { fontSize: 13 } })
            ),
            e("div", { className: "gp-gl-stat-n" }, stats.oldest ? stats.oldest.name : "—"),
            e("div", { className: "gp-gl-stat-l" }, stats.oldest ? `Oldest \u00B7 ${stats.oldest.year}` : "Oldest")
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
        genres.length > 1 && e(GpDropdown, {
          value:    genre,
          onChange: v => { setGenre(v); setPage(1); load(1, sort, v, search); },
          options:  [{ value:"", label:"All Genres" }, ...genres.map(g => ({ value:g.slug, label:g.name }))],
        }),
        e(GpDropdown, {
          value:    sort,
          onChange: v => { setSort(v); setPage(1); load(1, v, genre, search); },
          options:  [
            { value:"newest", label:"Date Added" },
            { value:"az",     label:"A → Z" },
            { value:"year",   label:"Release Year" },
          ],
        })
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
                    { _match: NE.matchRoute(`/ext/gamepedia/games/${game.slug}`), slug: game.slug });
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
      if (!currentUser?.id) { setLoading(false); return; }
      apiFetch(`/gamelog/${currentUser.id}?sort=newest&page=1`)
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
              { _match: NE.matchRoute(`/ext/gamepedia/gamelog/${currentUser.id}`), user_id: currentUser.id });
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
            { _match: NE.matchRoute(`/ext/gamepedia/games/${game.slug}`), slug: game.slug });
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
    const [editAwardGame,setEditAwardGame]=useState(null);
    const searchTimer = useRef(null);

    // Genres tab state
    const [genres,       setGenres]      = useState([]);
    const [genresLoading,setGenresLoading]=useState(true);
    const [newGenre,     setNewGenre]    = useState("");
    const [creatingGenre,setCreatingGenre]=useState(false);

    // Stats tab state
    const [stats,        setStats]       = useState(null);
    const [statsLoading, setStatsLoading]= useState(false);

    // Settings — from Nexus extension settings via API
    const [creds,        setCreds]       = useState({ client_id: "", client_secret: "" });
    const [credInput,    setCredInput]   = useState({ client_id: "", client_secret: "", webhook_secret: "" });
    const [credSaving,   setCredSaving]  = useState(false);
    const [credSaved,    setCredSaved]   = useState(false);
    const [maxLinkedGames,   setMaxLinkedGames]   = useState(3);
    const [slideshowSeconds, setSlideshowSeconds] = useState(5);

    // Digest tab state — counts per section
    const [digestCfg,    setDigestCfg]   = useState({
      new_games_count:      6,
      top_gamelogs_count:   6,
      most_discussed_count: 6,
    });
    const [digestLoaded, setDigestLoaded] = useState(false);

    useEffect(() => {
      // Load saved IGDB credentials from extension settings
      fetch("/api/v1/admin/extensions/gamepedia", { headers: authHeaders() })
        .then(r => r.json())
        .then(d => {
          const s = d.extension?.settings || {};
          const loaded = {
            client_id:      s.igdb_client_id     || "",
            client_secret:  s.igdb_client_secret || "",
            webhook_secret: s.webhook_secret      || "",
          };
          setCreds({ client_id: loaded.client_id, client_secret: loaded.client_secret });
          setCredInput(loaded);
          setDigestCfg({
            new_games_count:      parseInt(s.digest_new_games_count)      || 6,
            top_gamelogs_count:   parseInt(s.digest_top_gamelogs_count)   || 6,
            most_discussed_count: parseInt(s.digest_most_discussed_count) || 6,
          });
          const ml = parseInt(s.max_linked_games) || 3;
          const ss = parseInt(s.slideshow_seconds) || 5;
          setMaxLinkedGames(ml);
          setSlideshowSeconds(ss);
          window._gpMaxLinkedGames = ml;
          window._gpSlideshowSeconds = ss;
          setDigestLoaded(true);
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
        ["games", "genres", "stats", "digest", "settings"].map(t =>
          e("button", {
            key:       t,
            className: "gp-admin-tab" + (tab === t ? " active" : ""),
            onClick:   () => {
              setTab(t);
              if (t === "stats" && !stats) loadStats();
              // Wire the top-bar Save Changes button to save extension settings
              window._nexusAdminSaveFn = async () => {
                if (t === "settings") {
                  await fetch("/api/v1/admin/extensions/gamepedia/settings", {
                    method: "PATCH", headers: authHeaders(),
                    body: JSON.stringify({ settings: {
                      igdb_client_id:     credInput.client_id,
                      igdb_client_secret: credInput.client_secret,
                      webhook_secret:     credInput.webhook_secret,
                    }}),
                  });
                  setCreds({ client_id: credInput.client_id, client_secret: credInput.client_secret });
                } else if (t === "digest") {
                  await fetch("/api/v1/admin/extensions/gamepedia/settings", {
                    method: "PATCH", headers: authHeaders(),
                    body: JSON.stringify({ settings: {
                      digest_new_games_count:      digestCfg.new_games_count,
                      digest_top_gamelogs_count:   digestCfg.top_gamelogs_count,
                      digest_most_discussed_count: digestCfg.most_discussed_count,
                    }}),
                  });
                } else if (t === "settings") {
                  await fetch("/api/v1/admin/extensions/gamepedia/settings", {
                    method: "PATCH", headers: authHeaders(),
                    body: JSON.stringify({ settings: {
                      igdb_client_id:     credInput.client_id,
                      igdb_client_secret: credInput.client_secret,
                      webhook_secret:     credInput.webhook_secret,
                      max_linked_games:   maxLinkedGames,
                      slideshow_seconds:  slideshowSeconds,
                    }}),
                  });
                  setCreds({ client_id: credInput.client_id, client_secret: credInput.client_secret });
                }
              };
              window._nexusAdminSetDirty && window._nexusAdminSetDirty();
            },
          },
            e("span", { style: { display: "flex", alignItems: "center", gap: 6 } },
              e("i", { className:
                t === "games"       ? "fa-solid fa-gamepad" :
                t === "genres"      ? "fa-solid fa-tags" :
                t === "stats"       ? "fa-solid fa-chart-bar" :
                t === "digest"      ? "fa-solid fa-envelope-open-text" : "fa-solid fa-key",
                style: { fontSize: 12 }
              }),
              t === "games" ? "Games" : t === "genres" ? "Genres" : t === "stats" ? "Stats" : t === "digest" ? "Digest" : "Settings"
            )
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
            e(GpDropdown, {
              value:    genreFilter,
              onChange: v => { setGenreFilter(v); loadGames(1); },
              options:  [{ value:"", label:"All Genres" }, ...filterGenres.map(g => ({ value:g.slug, label:g.name }))],
            }),
            e(GpDropdown, {
              value:    sort,
              onChange: v => { setSort(v); loadGames(1); },
              options:  [
                { value:"newest", label:"Newest Added" },
                { value:"oldest", label:"Oldest Added" },
                { value:"az",     label:"A → Z" },
                { value:"za",     label:"Z → A" },
              ],
            })
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
                e("button", { className: "gp-admin-btn", title: "Awards", onClick: () => setEditAwardGame(game) },
                  e("i", { className: "fa-solid fa-trophy" })
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
        !genresLoading && genres.length > 0 && e("div", { className: "gp-genre-card-grid" },
          genres.map(g =>
            e("div", { key: g.id, className: "gp-genre-card" },
              e("div", { className: "gp-genre-card-name" }, g.name),
              e("div", { className: "gp-genre-card-count" },
                g.game_count !== undefined
                  ? (g.game_count === 1 ? "1 game" : `${g.game_count} games`)
                  : ""
              ),
              e("button", {
                className: "gp-genre-card-del",
                title:     "Delete",
                onClick:   ev => { ev.stopPropagation(); deleteGenre(g); },
              }, e("i", { className: "fa-solid fa-xmark", style: { fontSize: 10 } }))
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
      // ── Digest Tab ───────────────────────────────────────────────────────────
      tab === "digest" && e("div", null,
        e("p", { style: { fontSize: 12, color: "var(--t4)", marginBottom: 20 } },
          "Configure how many games appear in each digest email section. Changes are saved via the Save Changes button above."
        ),
        [
          { key: "new_games_count",      icon: "fa-gamepad",           label: "New Games",      desc: "Games added to the library during the digest period." },
          { key: "top_gamelogs_count",   icon: "fa-bookmark",          label: "Most Gamelog’d", desc: "Games with the most new gamelog entries during the period." },
          { key: "most_discussed_count", icon: "fa-comments",          label: "Most Discussed", desc: "Games linked to the most forum threads during the period." },
        ].map(section =>
          e("div", { key: section.key, style: { background: "var(--s1)", border: "0.5px solid var(--b1)", borderRadius: 10, padding: "16px 20px", marginBottom: 12 } },
            e("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 4 } },
              e("div", { style: { width: 30, height: 30, borderRadius: 8, background: "rgba(139,92,246,.12)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ac)", flexShrink: 0 } },
                e("i", { className: "fa-solid " + section.icon, style: { fontSize: 13 } })
              ),
              e("span", { style: { fontSize: 13, fontWeight: 500, color: "var(--t1)" } }, section.label)
            ),
            e("p", { style: { fontSize: 12, color: "var(--t4)", margin: "0 0 14px 40px" } }, section.desc),
            e("div", { style: { display: "flex", alignItems: "center", gap: 10, marginLeft: 40 } },
              e("span", { style: { fontSize: 12, fontWeight: 500, color: "var(--t4)", textTransform: "uppercase", letterSpacing: ".06em", width: 130 } }, "Games to show"),
              e("input", {
                className: "gp-input",
                type:      "number",
                min:       1,
                max:       20,
                style:     { width: 64, textAlign: "center" },
                value:     digestCfg[section.key],
                onChange:  ev => {
                  const v = Math.max(1, Math.min(20, parseInt(ev.target.value) || 6));
                  setDigestCfg(p => ({ ...p, [section.key]: v }));
                  window._nexusAdminSetDirty && window._nexusAdminSetDirty();
                },
              }),
              e("span", { style: { fontSize: 12, color: "var(--t5)" } }, "max per digest")
            )
          )
        )
      ),

      // ── Settings Tab ─────────────────────────────────────────────────────────
      tab === "settings" && e("div", null,

        e("div", { className: "gp-settings-section" },
          e("div", { className: "gp-settings-section-title" }, "IGDB credentials"),
          e("p", { style: { fontSize: 12, color: "var(--t4)", marginBottom: 16 } },
            "Required to search and import games. Get them free at ",
            e("a", { href: "https://dev.twitch.tv", target: "_blank", style: { color: "var(--ac)" } }, "dev.twitch.tv"), "."
          ),
          [
            { key: "client_id",      label: "Client ID",     type: "text",     placeholder: "your_twitch_client_id" },
            { key: "client_secret",  label: "Client Secret", type: "password", placeholder: "your_twitch_client_secret" },
            { key: "webhook_secret", label: "Webhook Secret",type: "password", placeholder: "optional" },
          ].map(field =>
            e("div", { key: field.key, style: { marginBottom: 14 } },
              e("label", { style: { fontSize: 12, color: "var(--t4)", display: "block", marginBottom: 6, fontWeight: 500 } }, field.label),
              e("input", {
                className:   "gp-input",
                type:        field.type,
                style:       { width: "100%" },
                placeholder: field.placeholder,
                value:       credInput[field.key],
                onChange:    ev => setCredInput(p => ({ ...p, [field.key]: ev.target.value })),
              })
            )
          )
        ),

        e("div", { className: "gp-settings-section" },
          e("div", { className: "gp-settings-section-title" }, "Post sidebar"),
          e("div", { style: { display: "flex", flexDirection: "column", gap: 14 } },
            e("div", null,
              e("label", { style: { fontSize: 12, color: "var(--t4)", display: "block", marginBottom: 6, fontWeight: 500 } }, "Max linked games per post"),
              e("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
                e("input", {
                  className: "gp-input",
                  type:      "number",
                  min:       1, max: 10,
                  style:     { width: 72 },
                  value:     maxLinkedGames,
                  onChange:  ev => {
                    setMaxLinkedGames(Math.max(1, Math.min(10, parseInt(ev.target.value) || 3)));
                    window._nexusAdminSetDirty && window._nexusAdminSetDirty();
                  },
                }),
                e("span", { style: { fontSize: 12, color: "var(--t5)" } }, "games (default 3)")
              )
            ),
            e("div", null,
              e("label", { style: { fontSize: 12, color: "var(--t4)", display: "block", marginBottom: 6, fontWeight: 500 } }, "Slideshow timer"),
              e("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
                e("input", {
                  className: "gp-input",
                  type:      "number",
                  min:       2, max: 30,
                  style:     { width: 72 },
                  value:     slideshowSeconds,
                  onChange:  ev => {
                    setSlideshowSeconds(Math.max(2, Math.min(30, parseInt(ev.target.value) || 5)));
                    window._nexusAdminSetDirty && window._nexusAdminSetDirty();
                  },
                }),
                e("span", { style: { fontSize: 12, color: "var(--t5)" } }, "seconds per game")
              )
            )
          )
        ),

        e("p", { style: { fontSize: 12, color: "var(--t4)", marginTop: 4 } },
          e("i", { className: "fa-solid fa-info-circle", style: { marginRight: 5 } }),
          "Use the Save Changes button above to save all settings."
        )
      ),

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
      }),

      // ── Awards Modal ───────────────────────────────────────────────────────
      editAwardGame && e(AwardsModal, {
        game:    editAwardGame,
        onClose: () => setEditAwardGame(null),
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
      fetch(`/ext/gamepedia/api/games/search?q=${encodeURIComponent(q)}&client_id=${encodeURIComponent(creds.client_id)}&client_secret=${encodeURIComponent(creds.client_secret)}`)
        .then(r => r.json())
        .then(r => { setLoading(false); setResults(r.data || []); if (r.error) setError(r.error); })
        .catch(() => { setLoading(false); setError("Search failed."); });
    }

    function addGame(game) {
      setAdding(p => ({ ...p, [game.igdb_id]: true }));
      fetch("/ext/gamepedia/api/admin/games/import", {
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
                : e("div", { className: "gp-import-nocover" }, e("i", { className: "fa-solid fa-gamepad" })),
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
  // AwardsModal — manage awards for a game (admin only)
  // ---------------------------------------------------------------------------

  function AwardsModal({ game, onClose }) {
    const [awards,   setAwards]   = useState([]);
    const [loading,  setLoading]  = useState(true);
    const [saving,   setSaving]   = useState(false);
    const [error,    setError]    = useState(null);
    const [newYear,  setNewYear]  = useState(new Date().getFullYear().toString());
    const [newTitle, setNewTitle] = useState("");
    const [editId,   setEditId]   = useState(null);
    const [editYear, setEditYear] = useState("");
    const [editTitle,setEditTitle]= useState("");

    function loadAwards() {
      setLoading(true);
      apiFetch(`/admin/games/${game.id}/awards`)
        .then(r => { setAwards(r.data || []); setLoading(false); })
        .catch(() => setLoading(false));
    }

    useEffect(() => { loadAwards(); }, [game.id]);

    function addAward() {
      if (!newYear.trim() || !newTitle.trim()) return;
      setSaving(true); setError(null);
      apiFetch(`/admin/games/${game.id}/awards`, {
        method: "POST",
        body: { year: newYear.trim(), title: newTitle.trim() },
      })
        .then(r => {
          if (r.ok) { setNewTitle(""); loadAwards(); }
          else setError(r.error || "Failed to add award");
        })
        .catch(() => setError("Network error"))
        .finally(() => setSaving(false));
    }

    function saveEdit(id) {
      if (!editYear.trim() || !editTitle.trim()) return;
      setSaving(true); setError(null);
      apiFetch(`/admin/awards/${id}`, {
        method: "PATCH",
        body: { year: editYear.trim(), title: editTitle.trim() },
      })
        .then(r => {
          if (r.ok) { setEditId(null); loadAwards(); }
          else setError(r.error || "Failed to update award");
        })
        .catch(() => setError("Network error"))
        .finally(() => setSaving(false));
    }

    function deleteAward(id) {
      setSaving(true); setError(null);
      apiFetch(`/admin/awards/${id}`, { method: "DELETE" })
        .then(r => {
          if (r.ok) loadAwards();
          else setError(r.error || "Failed to delete award");
        })
        .catch(() => setError("Network error"))
        .finally(() => setSaving(false));
    }

    return e("div", { className: "gp-modal-overlay", onClick: e => { if (e.target === e.currentTarget) onClose(); } },
      e("div", { className: "gp-modal", style: { maxWidth: 500 } },
        e("div", { className: "gp-modal-header" },
          e("span", { className: "gp-modal-title" }, `Awards — ${game.name}`),
          e("button", { className: "gp-modal-close", onClick: onClose }, "\u00D7")
        ),

        e("div", { style: { padding: "20px 20px 4px", overflowY: "auto", flex: 1 } },

        error && e("div", { style: { color: "var(--red)", fontSize: 13, paddingBottom: 10 } }, error),

        // Existing awards list
        loading
          ? e("div", { style: { color: "var(--t4)", fontSize: 13, padding: "12px 0" } }, "Loading\u2026")
          : awards.length === 0
            ? e("div", { style: { color: "var(--t4)", fontSize: 13, padding: "12px 0" } }, "No awards yet.")
            : e("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 } },
                awards.map(a =>
                  editId === a.id
                    ? e("div", { key: a.id, style: { display: "flex", gap: 8, alignItems: "center" } },
                        e("input", {
                          style: { width: 60, padding: "6px 8px", background: "var(--s3)", border: "0.5px solid var(--b2)", borderRadius: 8, color: "var(--t1)", fontSize: 13 },
                          value: editYear, onChange: ev => setEditYear(ev.target.value),
                          placeholder: "Year",
                        }),
                        e("input", {
                          style: { flex: 1, padding: "6px 10px", background: "var(--s3)", border: "0.5px solid var(--b2)", borderRadius: 8, color: "var(--t1)", fontSize: 13 },
                          value: editTitle, onChange: ev => setEditTitle(ev.target.value),
                          placeholder: "Award title",
                        }),
                        e("button", { className: "gp-btn-primary", style: { padding: "6px 12px", fontSize: 12 }, disabled: saving, onClick: () => saveEdit(a.id) }, "Save"),
                        e("button", { className: "gp-admin-btn", style: { fontSize: 12 }, onClick: () => setEditId(null) }, "Cancel")
                      )
                    : e("div", { key: a.id, style: { display: "flex", alignItems: "center", gap: 10, background: "rgba(251,191,36,.06)", border: "0.5px solid rgba(251,191,36,.2)", borderRadius: 8, padding: "8px 12px" } },
                        e("i", { className: "fa-solid fa-trophy", style: { color: "#fbbf24", fontSize: 14, flexShrink: 0 } }),
                        e("span", { style: { flex: 1, fontSize: 13, color: "var(--t1)" } }, a.title),
                        e("span", { style: { fontSize: 11, color: "var(--t4)", flexShrink: 0 } }, a.year),
                        e("button", {
                          className: "gp-admin-btn",
                          style: { fontSize: 11, padding: "3px 8px" },
                          onClick: () => { setEditId(a.id); setEditYear(a.year); setEditTitle(a.title); }
                        }, e("i", { className: "fa-solid fa-pencil" })),
                        e("button", {
                          className: "gp-admin-btn gp-admin-btn-danger",
                          style: { fontSize: 11, padding: "3px 8px" },
                          disabled: saving,
                          onClick: () => deleteAward(a.id),
                        }, e("i", { className: "fa-solid fa-trash" }))
                      )
                )
              ),

        // Add new award
        e("div", { style: { borderTop: "0.5px solid var(--b1)", paddingTop: 16 } },
          e("div", { style: { fontSize: 12, fontWeight: 500, color: "var(--t4)", letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 10 } }, "Add award"),
          e("div", { style: { display: "flex", gap: 8 } },
            e("input", {
              style: { width: 70, padding: "8px 10px", background: "var(--s3)", border: "0.5px solid var(--b2)", borderRadius: 8, color: "var(--t1)", fontSize: 13 },
              value: newYear, onChange: ev => setNewYear(ev.target.value),
              placeholder: "Year", maxLength: 4,
            }),
            e("input", {
              style: { flex: 1, padding: "8px 12px", background: "var(--s3)", border: "0.5px solid var(--b2)", borderRadius: 8, color: "var(--t1)", fontSize: 13 },
              value: newTitle, onChange: ev => setNewTitle(ev.target.value),
              placeholder: "e.g. Game of the Year", maxLength: 100,
              onKeyDown: ev => { if (ev.key === "Enter") addAward(); },
            }),
            e("button", {
              className: "gp-btn-primary",
              disabled: saving || !newYear.trim() || !newTitle.trim(),
              onClick: addAward,
            }, saving ? e("i", { className: "fa-solid fa-spinner fa-spin" }) : e("i", { className: "fa-solid fa-plus" }))
          )
        )

        ) // end padded body wrapper
      )
    );
  }

  // ---------------------------------------------------------------------------
  // EditGenresModal
  // ---------------------------------------------------------------------------

  function EditGenresModal({ game, genres, onSaved, onClose }) {
    const [sel,    setSel]    = useState(new Set((game.genres || []).map(g => g.id)));
    const [saving, setSaving] = useState(false);

    function toggle(id) {
      setSel(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
    }

    function save() {
      setSaving(true);
      fetch(`/ext/gamepedia/api/admin/games/${game.id}/genres`, {
        method:  "POST",
        headers: authHeaders(),
        body:    JSON.stringify({ genre_ids: Array.from(sel) }),
      })
        .then(() => { onSaved({ ...game, genres: genres.filter(g => sel.has(g.id)) }); })
        .catch(() => alert("Failed to save genres."))
        .finally(() => setSaving(false));
    }

    return e("div", {
      style: { position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:9000,
               display:"flex",alignItems:"center",justifyContent:"center",padding:24 },
      onMouseDown: ev => { if (ev.target === ev.currentTarget) onClose(); },
    },
      e("div", {
        style: { background:"var(--s1)",border:"0.5px solid var(--b2)",borderRadius:16,
                 width:"100%",maxWidth:560,boxShadow:"0 8px 48px rgba(0,0,0,.6)" }
      },
        e("div", {
          style: { display:"flex",alignItems:"center",justifyContent:"space-between",
                   padding:"18px 24px",borderBottom:"0.5px solid var(--b1)" }
        },
          e("span", { style:{ fontSize:16,fontWeight:500,color:"var(--t1)" } },
            `Genres — ${game.name}`),
          e("button", {
            onClick: onClose,
            style: { background:"none",border:"none",color:"var(--t4)",fontSize:20,cursor:"pointer",lineHeight:1 }
          }, "×")
        ),
        e("div", {
          style: { padding:"16px 24px",display:"grid",
                   gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",
                   gap:10,maxHeight:360,overflowY:"auto" }
        },
          genres.length === 0
            ? e("p", { style:{ fontSize:13,color:"var(--t4)",gridColumn:"1/-1",textAlign:"center",padding:"20px 0" } },
                "No genres yet. Create some in the Genres tab.")
            : genres.map(g => {
                const active = sel.has(g.id);
                return e("div", {
                  key: g.id, onClick: () => toggle(g.id),
                  style: {
                    padding:"10px 14px",borderRadius:10,cursor:"pointer",
                    border:"1.5px solid " + (active ? "var(--ac)" : "var(--b1)"),
                    background: active ? "rgba(167,139,250,0.12)" : "var(--s2)",
                    color: active ? "var(--ac)" : "var(--t3)",
                    transition:"all .1s",display:"flex",alignItems:"center",gap:8,
                    fontSize:14,fontWeight: active ? 500 : 400,
                  }
                },
                  active && e("i", { className:"fa-solid fa-check", style:{ fontSize:12,flexShrink:0 } }),
                  g.name
                );
              })
        ),
        e("div", {
          style: { padding:"16px 24px",borderTop:"0.5px solid var(--b1)",
                   display:"flex",justifyContent:"flex-end",gap:10 }
        },
          e("button", {
            onClick: () => setSel(new Set()),
            style: { background:"none",border:"0.5px solid var(--b2)",borderRadius:8,
                     color:"var(--t3)",cursor:"pointer",fontSize:14,padding:"8px 16px",fontFamily:"inherit" }
          }, "Clear"),
          e("button", {
            onClick: save, disabled: saving,
            style: { background:"var(--ac)",border:"none",borderRadius:8,color:"#fff",
                     cursor: saving ? "default" : "pointer",fontSize:14,fontWeight:500,
                     padding:"8px 20px",fontFamily:"inherit",opacity: saving ? 0.6 : 1 }
          }, saving ? "Saving…" : sel.size > 0 ? `Save ${sel.size} genre${sel.size > 1 ? "s" : ""}` : "Save")
        )
      )
    );
  }
  // ---------------------------------------------------------------------------
  // Game Detail Page — /ext/gamepedia/games/:slug
  // ---------------------------------------------------------------------------

  function GameDetailPage({ slug, currentUser, navigate }) {
    const [game,        setGame]        = useState(null);
    const [loading,     setLoading]     = useState(true);
    const [error,       setError]       = useState(null);
    const [posts,       setPosts]       = useState([]);
    const [postDetails, setPostDetails] = useState({});
    const [inGamelog,   setInGamelog]   = useState(false);
    const [isPlaying,   setIsPlaying]   = useState(false);
    const [logBusy,     setLogBusy]     = useState(false);
    // Ratings — seed from game data once loaded
    const [userRating,      setUserRating]      = useState(0);
    const [hoverRating,     setHoverRating]     = useState(0);
    const [ratingBusy,      setRatingBusy]      = useState(false);
    const [ratingAvg,       setRatingAvg]       = useState(null);
    const [ratingCount,     setRatingCount]     = useState(0);
    const [ratingDist,      setRatingDist]      = useState([]);

    useEffect(() => {
      if (!slug) return;
      setLoading(true);
      setUserRating(0); setRatingAvg(null); setRatingCount(0);
      setInGamelog(false); setIsPlaying(false); setPosts([]); setPostDetails({});

      apiFetch(`/games/${encodeURIComponent(slug)}`)
        .then(r => {
          if (r.error) { setError(r.error); setLoading(false); return; }
          const g = r.data;
          setGame(g);
          setLoading(false);
          // Seed ratings from game response
          if (g.rating_avg   !== undefined) setRatingAvg(g.rating_avg);
          if (g.rating_count !== undefined) setRatingCount(g.rating_count);
          if (g.rating_distribution) setRatingDist(g.rating_distribution);
          if (g.user_rating)          setUserRating(g.user_rating);

          // Forum threads
          if (g.id) {
            apiFetch(`/games/${g.id}/posts`)
              .then(pr => {
                const ids = pr.data || [];
                setPosts(ids);
                ids.forEach(postId => {
                  fetch(`/api/v1/posts/${postId}`, {
                    headers: { "Authorization": `Bearer ${localStorage.getItem("nexus_token") || ""}` }
                  })
                    .then(res => res.json())
                    .then(pd => { if (pd.post) setPostDetails(prev => ({ ...prev, [postId]: pd.post })); })
                    .catch(() => {});
                });
              });
          }

          // Gamelog state
          if (currentUser?.id && g.id) {
            apiFetch(`/gamelog/${currentUser.id}`)
              .then(gr => {
                const entry = (gr.data || []).find(x => x.id === g.id);
                if (entry) { setInGamelog(true); setIsPlaying(entry.is_playing); }
              })
              .catch(() => {});
          }
        })
        .catch(() => { setError("Failed to load game."); setLoading(false); });
    }, [slug]);

    function toggleGamelog() {
      if (!currentUser) return;
      setLogBusy(true);
      if (inGamelog) {
        apiFetch(`/gamelog/${game.id}`, { method: "DELETE" })
          .then(() => { setInGamelog(false); setIsPlaying(false); })
          .finally(() => setLogBusy(false));
      } else {
        apiFetch("/gamelog", { method: "POST", body: { game_id: game.id } })
          .then(() => setInGamelog(true))
          .finally(() => setLogBusy(false));
      }
    }

    function togglePlaying() {
      if (!currentUser || !inGamelog) return;
      setLogBusy(true);
      apiFetch(`/gamelog/${game.id}/playing`, { method: "POST", body: {} })
        .then(r => { if (r.ok) setIsPlaying(r.is_playing); })
        .finally(() => setLogBusy(false));
    }

    function submitRating(stars) {
      if (!currentUser || ratingBusy) return;
      if (stars === userRating) {
        // clicking same star = remove rating
        setRatingBusy(true);
        apiFetch(`/games/${game.id}/rate`, { method: "DELETE" })
          .then(r => {
            if (r.ok) {
              setUserRating(0);
              setRatingAvg(r.summary?.avg ?? null);
              setRatingCount(r.summary?.count ?? 0);
              if (r.summary?.distribution) setRatingDist(r.summary.distribution);
            }
          })
          .finally(() => setRatingBusy(false));
        return;
      }
      setRatingBusy(true);
      setUserRating(stars);
      apiFetch(`/games/${game.id}/rate`, { method: "POST", body: { rating: stars } })
        .then(r => {
          if (r.ok) {
            setRatingAvg(r.summary?.avg ?? null);
            setRatingCount(r.summary?.count ?? 0);
            if (r.summary?.distribution) setRatingDist(r.summary.distribution);
          } else {
            setUserRating(0);
          }
        })
        .catch(() => setUserRating(0))
        .finally(() => setRatingBusy(false));
    }

    function goToPost(postId) {
      if (window._nexusNavigate) window._nexusNavigate("post", { id: postId });
    }

    // 5-star renderer (used for rating input and display)
    function StarRow({ value, onHover, onLeave, onClick, hover, size }) {
      const sz = size || 22;
      return e("div", { style: { display: "flex", gap: 4 } },
        [1,2,3,4,5].map(star => {
          const filled = star <= (hover || value);
          return e("i", {
            key: star,
            className: filled ? "fa-solid fa-star" : "fa-regular fa-star",
            style: {
              fontSize: sz,
              color: filled ? "#a78bfa" : "rgba(255,255,255,.2)",
              cursor: onClick ? "pointer" : "default",
              transition: "color .1s",
            },
            onMouseEnter: onHover ? () => onHover(star) : undefined,
            onMouseLeave: onLeave || undefined,
            onClick: onClick ? () => onClick(star) : undefined,
          });
        })
      );
    }

    // Bar chart for rating distribution
    function RatingDistBar({ distribution }) {
      if (!distribution?.length) return null;
      const max = Math.max(...distribution.map(d => d.count), 1);
      return e("div", { style: { display: "flex", alignItems: "flex-end", gap: 2, height: 32, marginTop: 8 } },
        distribution.map(d =>
          e("div", {
            key: d.score,
            title: `${d.score}/10: ${d.count} rating${d.count === 1 ? "" : "s"}`,
            style: {
              flex: 1,
              height: `${Math.max(2, Math.round((d.count / max) * 32))}px`,
              background: d.count > 0 ? "var(--ac)" : "rgba(255,255,255,.08)",
              borderRadius: 2,
              transition: "height .2s",
            }
          })
        )
      );
    }

    if (loading) return e("div", { className: "gp-loading" },
      e("i", { className: "fa-solid fa-spinner fa-spin" }), " Loading\u2026"
    );
    if (error) return e("div", { className: "gp-error" }, error);
    if (!game)  return null;

    const heroUrl      = game.screenshots?.[0]?.webp_url || game.screenshots?.[0]?.url?.replace("t_screenshot_big", "t_screenshot_huge") || null;
    const displayRating = hoverRating || userRating;
    const awards       = game.awards || [];

    return e("div", { className: "gp-detail" },

      // ── Hero ──────────────────────────────────────────────────────────────
      e("div", { className: "gp-detail-hero", style: heroUrl ? {} : { minHeight: 160 } },
        heroUrl && e("img", { src: heroUrl, alt: "", className: "gp-detail-hero-img" }),
        e("div", { className: "gp-detail-hero-overlay" }),
        e("div", { className: "gp-detail-hero-content" },
          e("div", { style: { display: "flex", flexDirection: "column", justifyContent: "flex-start", flexShrink: 0, alignSelf: "flex-start" } },
            game.cover_image_url
              ? e("img", { src: game.cover_image_url, alt: game.name, className: "gp-detail-cover" })
              : e("div", { className: "gp-detail-cover gp-detail-cover-empty" },
                  e("i", { className: "fa-solid fa-gamepad" })
                )
          ),
          e("div", { style: { flex: 1, minWidth: 0 } },
            game.genres?.length > 0 && e("div", { className: "gp-detail-genres" },
              game.genres.map(g => e("span", { key: g.id, className: "gp-genre-tag" }, g.name))
            ),
            e("h1", { className: "gp-detail-title" }, game.name),
            e("div", { className: "gp-detail-sub" },
              [game.developer, game.publisher, game.release_year]
                .filter(Boolean).map(String).join(" \u00B7 ")
            ),

            // Awards ribbon (if any)
            awards.length > 0 && e("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 } },
              awards.map(a =>
                e("span", {
                  key: a.id,
                  style: {
                    display: "flex", alignItems: "center", gap: 5,
                    background: "rgba(251,191,36,.12)",
                    border: "0.5px solid rgba(251,191,36,.3)",
                    borderRadius: 20,
                    padding: "3px 10px",
                    fontSize: 11, fontWeight: 500,
                    color: "#fbbf24",
                  }
                },
                  e("i", { className: "fa-solid fa-trophy", style: { fontSize: 10 } }),
                  `${a.title}`,
                  e("span", { style: { opacity: 0.6, marginLeft: 2 } }, a.year)
                )
              )
            ),

            // Community rating summary
            e("div", { className: "gp-detail-hero-rating" },
              e("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                ratingAvg
                  ? e("i", { className: "fa-solid fa-star", style: { fontSize: 16, color: "#a78bfa", marginRight: 2 } })
                  : null,
                ratingAvg
                  ? e("span", { style: { fontSize: 22, fontWeight: 700, color: "var(--ac-text)" } }, ratingAvg.toFixed(1))
                  : null,
                ratingAvg
                  ? e("span", { style: { fontSize: 11, color: "rgba(255,255,255,.35)" } },
                      `/ 5 \u00B7 ${ratingCount} rating${ratingCount === 1 ? "" : "s"}`
                    )
                  : e("span", { style: { fontSize: 12, color: "rgba(255,255,255,.3)" } }, "No ratings yet")
              ),
              // User rating input
              currentUser && e("div", { style: { marginTop: 10 } },
                e("div", { style: { fontSize: 11, color: "rgba(255,255,255,.4)", marginBottom: 6 } },
                  userRating > 0 ? `Your rating: ${userRating}/5 · click again to remove` : "Rate this game:"
                ),
                e(StarRow, {
                  value:   userRating,
                  hover:   hoverRating,
                  size:    24,
                  onHover: n => setHoverRating(n),
                  onLeave: () => setHoverRating(0),
                  onClick: submitRating,
                })
              )
            ),

            // Actions
            e("div", { className: "gp-detail-actions", style: { marginTop: 14 } },
              currentUser && e("button", {
                className: "gp-btn-primary",
                disabled:  logBusy,
                onClick:   toggleGamelog,
              },
                e("i", { className: inGamelog ? "fa-solid fa-bookmark" : "fa-regular fa-bookmark", style: { marginRight: 6 } }),
                inGamelog ? "In Gamelog" : "Add to Gamelog"
              ),
              currentUser && inGamelog && e("button", {
                className: "gp-btn" + (isPlaying ? " gp-btn-active" : ""),
                disabled:  logBusy,
                onClick:   togglePlaying,
              },
                e("i", { className: "fa-solid fa-play", style: { marginRight: 6 } }),
                isPlaying ? "Playing" : "Mark Playing"
              )
            )
          )
        )
      ),

      // ── Single column body ─────────────────────────────────────────────────
      e("div", { className: "gp-detail-single" },

        // About
        game.summary && e("div", { style: { marginBottom: 24 } },
          e("div", { className: "gp-detail-section-label" }, "About"),
          e("p", { className: "gp-detail-summary" }, game.summary)
        ),

        // Trailer
        game.trailer_youtube_id && e("div", { style: { marginBottom: 24 } },
          e("div", { className: "gp-detail-section-label" }, "Trailer"),
          e("div", {
            className: "yt-lite",
            "data-id": game.trailer_youtube_id,
          },
            e("img", {
              className: "yt-thumb",
              src:       `https://i.ytimg.com/vi/${game.trailer_youtube_id}/maxresdefault.jpg`,
              alt:       `${game.name} trailer`,
              loading:   "lazy",
              onError:   ev => { ev.target.src = `https://i.ytimg.com/vi/${game.trailer_youtube_id}/hqdefault.jpg`; },
            }),
            e("div", { className: "yt-play" },
              e("svg", { height: "48", viewBox: "0 0 68 48", width: "68", xmlns: "http://www.w3.org/2000/svg" },
                e("path", { d: "M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55c-2.93.78-4.63 3.26-5.42 6.19C.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z", fill: "#f00" }),
                e("path", { d: "M45 24 27 14v20", fill: "#fff" })
              )
            )
          )
        ),

        // Forum threads
        posts.length > 0 && e("div", { style: { marginBottom: 24 } },
          e("div", { className: "gp-detail-section-label" }, "Forum discussions"),
          e("div", { className: "gp-detail-threads" },
            posts.map(postId => {
              const post = postDetails[postId];
              const author = post?.user;
              const initials = author?.username ? author.username.slice(0, 2).toUpperCase() : "?";
              return e("div", {
                key:       postId,
                className: "gp-detail-thread-row",
                onClick:   () => goToPost(postId),
              },
                author?.avatar_url
                  ? e("img", { src: author.avatar_url, className: "gp-detail-thread-avatar", alt: author.username })
                  : e("div", { className: "gp-detail-thread-avatar gp-detail-thread-avatar-init" }, initials),
                e("div", { className: "gp-detail-thread-body" },
                  e("span", { className: "gp-detail-thread-name" },
                    post ? post.title : `Post #${postId}`
                  ),
                  post && e("span", { className: "gp-detail-thread-meta" },
                    author ? `${author.username} · ` : "",
                    `${post.reply_count || 0} repl${post.reply_count === 1 ? "y" : "ies"}`
                  )
                )
              );
            })
          )
        ),

        // Game info
        e("div", { style: { marginBottom: 24 } },
          e("div", { className: "gp-detail-section-label" }, "Game info"),
          e("div", { className: "gp-detail-info-block" },
            [
              game.developer    && { key: "Developer", val: game.developer },
              game.publisher    && { key: "Publisher",  val: game.publisher },
              game.release_year && { key: "Released",   val: String(game.release_year) },
              (game.gamelog_count > 0) && { key: "In gamelogs", val: `${game.gamelog_count} member${game.gamelog_count === 1 ? "" : "s"}` },
            ].filter(Boolean).map(row =>
              e("div", { key: row.key, className: "gp-detail-info-row" },
                e("span", { className: "gp-detail-info-key" }, row.key),
                e("span", { className: "gp-detail-info-val" }, row.val)
              )
            ),
            game.genres?.length > 0 && e("div", { className: "gp-detail-info-row" },
              e("span", { className: "gp-detail-info-key" }, "Genres"),
              e("div", { style: { display: "flex", gap: 4, flexWrap: "wrap" } },
                game.genres.map(g => e("span", { key: g.id, className: "gp-genre-tag" }, g.name))
              )
            )
          )
        ),

        // Awards section
        awards.length > 0 && e("div", { style: { marginBottom: 24 } },
          e("div", { className: "gp-detail-section-label" }, "Awards & recognition"),
          e("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
            awards.map(a =>
              e("div", {
                key: a.id,
                style: {
                  display: "flex", alignItems: "center", gap: 12,
                  background: "rgba(251,191,36,.07)",
                  border: "0.5px solid rgba(251,191,36,.2)",
                  borderRadius: 10, padding: "10px 14px",
                }
              },
                e("i", { className: "fa-solid fa-trophy", style: { color: "#fbbf24", fontSize: 16, flexShrink: 0 } }),
                e("div", { style: { flex: 1 } },
                  e("div", { style: { fontSize: 13, fontWeight: 500, color: "var(--t1)" } }, a.title),
                  e("div", { style: { fontSize: 11, color: "var(--t4)", marginTop: 2 } }, a.year)
                )
              )
            )
          )
        ),

        // Screenshots
        game.screenshots?.length > 0 && e("div", { style: { marginBottom: 24 } },
          e("div", { className: "gp-detail-section-label" }, "Screenshots"),
          e("div", { className: "gp-detail-screenshots" },
            game.screenshots.map((s, i) => {
              const thumbSrc = s.webp_url || s.url;
              const fullSrc  = s.jpg_url  || s.url?.replace("t_screenshot_big", "t_1080p") || s.url;
              return e("div", {
                key:       s.id || i,
                className: "gp-detail-shot",
                style:     { cursor: "pointer" },
                onClick:   () => { if (window._lbSetState) window._lbSetState({ src: fullSrc, originalSrc: fullSrc }); },
              },
                e("img", { src: thumbSrc, alt: `Screenshot ${i + 1}`, style: { width: "100%", height: "100%", objectFit: "cover", display: "block" } })
              );
            })
          )
        )
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Game Browse Page — /ext/gamepedia/browse  // ---------------------------------------------------------------------------
  // Game Browse Page — /ext/gamepedia/browse
  // ---------------------------------------------------------------------------


  // ── GpDropdown — styled like Nexus av-dd ───────────────────────────────────────
  function GpDropdown({ value, onChange, options, style }) {
    const [open, setOpen] = useState(false);
    const ref = React.useRef(null);

    React.useEffect(() => {
      function handleClick(e) {
        if (ref.current && !ref.current.contains(e.target)) setOpen(false);
      }
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }, []);

    const selected = options.find(o => o.value === value) || options[0];

    return e("div", { ref, style: { position:"relative", ...style } },
      e("button", {
        onClick: () => setOpen(o => !o),
        style: {
          display:"flex",alignItems:"center",gap:8,
          padding:"6px 10px 6px 12px",
          background:"rgba(255,255,255,0.05)",
          border:"0.5px solid var(--b2)",
          borderRadius:8,cursor:"pointer",
          fontSize:13,color:"var(--t2)",
          fontFamily:"inherit",
          minWidth:130,justifyContent:"space-between",
        }
      },
        e("span", null, selected ? selected.label : ""),
        e("i", { className:`fa-solid fa-chevron-${open?"up":"down"}`, style:{ fontSize:10,color:"var(--t5)" } })
      ),
      open && e("div", {
        style: {
          position:"absolute",top:"calc(100% + 6px)",left:0,minWidth:"100%",
          background:"var(--s2)",border:"0.5px solid var(--b3)",borderRadius:14,
          padding:6,zIndex:500,
          boxShadow:"0 8px 40px rgba(0,0,0,.5)",
        }
      },
        options.map(o =>
          e("div", {
            key: o.value,
            onClick: () => { onChange(o.value); setOpen(false); },
            style: {
              display:"flex",alignItems:"center",gap:10,
              padding:"9px 12px",borderRadius:8,cursor:"pointer",
              fontSize:13,
              color: o.value === value ? "var(--t1)" : "var(--t3)",
              background: o.value === value ? "rgba(255,255,255,0.06)" : "none",
              fontWeight: o.value === value ? 500 : 400,
            },
            onMouseEnter: ev => { ev.currentTarget.style.background="rgba(255,255,255,0.06)"; ev.currentTarget.style.color="var(--t1)"; },
            onMouseLeave: ev => { ev.currentTarget.style.background=o.value===value?"rgba(255,255,255,0.06)":"none"; ev.currentTarget.style.color=o.value===value?"var(--t1)":"var(--t3)"; },
          },
            o.value === value && e("i", { className:"fa-solid fa-check", style:{ fontSize:10,width:14,flexShrink:0 } }),
            o.value !== value && e("span", { style:{ width:14,flexShrink:0 } }),
            o.label
          )
        )
      )
    );
  }

  function GameBrowsePage({ navigate, currentUser }) {
    const [games,       setGames]       = useState([]);
    const [loading,     setLoading]     = useState(true);
    const [total,       setTotal]       = useState(0);
    const [page,        setPage]        = useState(1);
    const [hasMore,     setHasMore]     = useState(false);
    const [search,      setSearch]      = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [genres,      setGenres]      = useState([]);
    const [genre,       setGenre]       = useState("");
    const [sort,        setSort]        = useState("newest");
    const searchTimer = useRef(null);

    function load(p, s, g, q, append) {
      setLoading(true);
      if (!append) setGames([]);
      const params = new URLSearchParams({ page: p, sort: s });
      if (g) params.set("genre", g);
      if (q) params.set("search", q);
      apiFetch(`/games?${params}`)
        .then(r => {
          setGames(prev => append ? [...prev, ...(r.data || [])] : (r.data || []));
          setTotal(r.meta?.total || 0);
          setHasMore(r.meta?.has_more || false);
          if (r.filters?.genres) setGenres(r.filters.genres);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }

    useEffect(() => { load(1, sort, genre, search); }, []);

    return e("div", { className: "gp-gamelog-page" },
      e("div", { className: "gp-gl-filters" },
        e("input", {
          className:   "gp-input",
          type:        "text",
          placeholder: "Search games\u2026",
          value:       searchInput,
          style:       { flex: 1 },
          onChange:    ev => {
            setSearchInput(ev.target.value);
            clearTimeout(searchTimer.current);
            searchTimer.current = setTimeout(() => {
              setSearch(ev.target.value); setPage(1);
              load(1, sort, genre, ev.target.value);
            }, 400);
          },
        }),
        genres.length > 0 && e(GpDropdown, {
          value:    genre,
          onChange: v => { setGenre(v); setPage(1); load(1, sort, v, search); },
          options:  [{ value:"", label:"All Genres" }, ...genres.map(g => ({ value:g.slug, label:g.name }))],
        }),
        e(GpDropdown, {
          value:    sort,
          onChange: v => { setSort(v); setPage(1); load(1, v, genre, search); },
          options:  [
            { value:"newest", label:"Newest" },
            { value:"az",     label:"A → Z" },
            { value:"year",   label:"Release Year" },
          ],
        })
      ),

      !loading && e("p", { className: "gp-admin-count" }, `${total} game${total !== 1 ? "s" : ""}`),

      loading && games.length === 0 && e("div", { className: "gp-loading" },
        e("i", { className: "fa-solid fa-spinner fa-spin" }), " Loading\u2026"
      ),

      !loading && games.length === 0 && e("div", { className: "gp-empty" },
        "No games found."
      ),

      games.length > 0 && e("div", { className: "gp-grid" },
        games.map(game =>
          e("div", { key: game.id, className: "gp-gl-card" },
            e("a", { href: "#", className: "gp-gl-card-link", onClick: ev => {
              ev.preventDefault();
              if (window._nexusNavigate)
                window._nexusNavigate("ext-route",
                  { _match: NE.matchRoute(`/ext/gamepedia/games/${game.slug}`), slug: game.slug });
            } },
              game.cover_image_url
                ? e("img", { src: game.cover_image_url, alt: game.name, className: "gp-gl-card-cover" })
                : e("div", { className: "gp-gl-card-nocover" }, e("i", { className: "fa-solid fa-gamepad" })),
              e("div", { className: "gp-gl-card-info" },
                e("div", { className: "gp-gl-card-name" }, game.name),
                game.release_year && e("div", { className: "gp-gl-card-year" }, String(game.release_year)),
                game.developer    && e("div", { className: "gp-gl-card-year" }, game.developer)
              )
            )
          )
        )
      ),

      hasMore && e("div", { style: { textAlign: "center", padding: "16px 0" } },
        e("button", {
          className: "gp-btn",
          disabled:  loading,
          onClick:   () => { const p = page + 1; setPage(p); load(p, sort, genre, search, true); },
        }, loading ? "Loading\u2026" : "Load more")
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
/* ── Post sidebar game card ── */
.gp-psb{margin-bottom:16px;}
.gp-rw-label{font-size:10px;font-weight:500;color:var(--t4);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;}
.gp-psb-cover-wrap{position:relative;width:100%;aspect-ratio:2/3;border-radius:10px;overflow:hidden;cursor:pointer;margin-bottom:10px;background:rgba(255,255,255,.04);}
.gp-psb-cover-img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .2s;}
.gp-psb-cover-wrap:hover .gp-psb-cover-img{transform:scale(1.03);}
.gp-psb-cover-empty{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:32px;color:var(--t5);}
.gp-psb-overlay{position:absolute;inset:0;background:linear-gradient(to top,rgba(8,6,16,.97) 0%,rgba(8,6,16,.55) 40%,rgba(8,6,16,.08) 75%,transparent 100%);}
.gp-psb-cover-bottom{position:absolute;bottom:0;left:0;right:0;padding:10px;}
.gp-psb-genres{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:5px;}
.gp-psb-genre-pill{font-size:10px;padding:2px 6px;border-radius:20px;background:rgba(139,92,246,.18);border:0.5px solid rgba(139,92,246,.3);color:#a78bfa;}
.gp-psb-name{font-size:14px;font-weight:500;color:#fff;line-height:1.25;margin-bottom:2px;}
.gp-psb-sub{font-size:11px;color:rgba(255,255,255,.38);}
.gp-psb-awards{display:flex;flex-direction:column;gap:4px;margin-bottom:10px;}
.gp-psb-award{display:flex;align-items:center;background:rgba(251,191,36,.1);border:0.5px solid rgba(251,191,36,.25);border-radius:20px;padding:3px 9px;font-size:10px;color:#fbbf24;width:fit-content;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.gp-psb-award-year{opacity:.5;margin-left:4px;}
.gp-psb-stats{display:flex;margin-bottom:10px;border:0.5px solid rgba(255,255,255,.07);border-radius:8px;overflow:hidden;}
.gp-psb-stat{flex:1;padding:7px 4px;text-align:center;border-right:0.5px solid rgba(255,255,255,.07);}
.gp-psb-stat:last-child{border-right:none;}
.gp-psb-stat-n{font-size:13px;font-weight:500;color:var(--t1);margin-bottom:1px;}
.gp-psb-stat-l{font-size:9px;color:var(--t4);text-transform:uppercase;letter-spacing:.04em;}
.gp-psb-btn{width:100%;padding:8px 0;border-radius:8px;font-size:12px;font-weight:500;text-align:center;cursor:pointer;margin-bottom:6px;box-sizing:border-box;transition:opacity .12s;}
.gp-psb-btn:hover{opacity:.85;}
.gp-psb-btn-view{background:rgba(139,92,246,.15);border:0.5px solid rgba(139,92,246,.35);color:#a78bfa;}
.gp-psb-btn-log{background:transparent;border:0.5px solid rgba(255,255,255,.12);color:var(--t3);}
.gp-psb-btn-added{background:rgba(139,92,246,.08);border:0.5px solid rgba(139,92,246,.3);color:#a78bfa;}

/* ── Profile sidebar link ── */
.gp-profile-link{display:flex;align-items:center;padding:6px 10px;font-size:13px;color:var(--t2);text-decoration:none;border-radius:8px;transition:background .12s;}
.gp-profile-link:hover{background:rgba(255,255,255,.06);color:var(--t1);}

/* ── Gamelog page ── */
.gp-gamelog-page{padding:16px 0;}
.gp-gl-stats{margin-bottom:16px;}
.gp-gl-stats-playing{display:flex;align-items:center;gap:8px;padding:8px 14px;background:rgba(139,92,246,.08);border:0.5px solid rgba(139,92,246,.2);border-radius:10px;margin-bottom:12px;}
.gp-gl-stats-playing-label{font-size:10px;color:var(--ac);font-weight:500;text-transform:uppercase;letter-spacing:.07em;}
.gp-gl-stats-playing-name{font-size:13px;color:var(--t1);font-weight:500;}
.gp-gl-stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}
.gp-gl-stat-card{background:rgba(255,255,255,.04);border-radius:10px;padding:12px 14px;}
.gp-gl-stat-icon{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:10px;}
.gp-gl-stat-n{font-size:16px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.gp-gl-stat-l{font-size:11px;color:var(--t4);margin-top:2px;}
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
.gp-detail{display:flex;flex-direction:column;}
.gp-detail-hero{position:relative;min-height:260px;display:flex;align-items:stretch;overflow:hidden;background:#13121e;}
.gp-detail-hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center top;}
.gp-detail-hero-overlay{position:absolute;inset:0;background:linear-gradient(to top,#0d0d14 0%,rgba(13,13,20,.8) 55%,rgba(13,13,20,.3) 100%);}
.gp-detail-hero-content{position:relative;z-index:1;display:flex;gap:16px;align-items:flex-start;padding:20px 20px 20px;width:100%;box-sizing:border-box;}
.gp-detail-cover{width:140px;height:196px;border-radius:8px;border:0.5px solid rgba(255,255,255,.15);object-fit:cover;flex-shrink:0;box-shadow:0 4px 20px rgba(0,0,0,.5);}
.gp-detail-cover-empty{background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;font-size:24px;color:var(--t5);}
.gp-detail-genres{display:flex;gap:5px;margin-bottom:7px;flex-wrap:wrap;}
.gp-detail-title{font-size:22px;font-weight:500;color:var(--t1);margin-bottom:3px;}
.gp-detail-sub{font-size:12px;color:var(--t4);margin-bottom:10px;}
.gp-detail-hero-rating{margin-bottom:4px;}
.gp-detail-actions{display:flex;gap:8px;flex-wrap:wrap;}
.gp-detail-single{padding:20px 20px 0;}
.gp-detail-section-label{font-size:10px;font-weight:500;color:var(--t4);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;}
.gp-detail-summary{font-size:13px;color:var(--t3);line-height:1.75;}
.gp-detail-threads{display:flex;flex-direction:column;gap:5px;}
.gp-detail-thread-row{background:var(--s2);border:0.5px solid var(--b1);border-radius:8px;padding:9px 12px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;transition:background .12s;}
.gp-detail-thread-row:hover{background:var(--s3);}
.gp-detail-thread-name{font-size:13px;color:var(--t2);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.gp-detail-thread-meta{font-size:11px;color:var(--t4);display:block;margin-top:2px;}
.gp-detail-info-block{background:var(--s2);border:0.5px solid var(--b1);border-radius:10px;padding:12px 14px;}
.gp-detail-info-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:0.5px solid rgba(255,255,255,.05);}
.gp-detail-info-row:last-child{border-bottom:none;}
.gp-detail-info-key{font-size:12px;color:var(--t4);}
.gp-detail-info-val{font-size:12px;color:var(--t2);text-align:right;}
.gp-detail-screenshots{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;}
.gp-detail-shot{aspect-ratio:16/9;border-radius:7px;overflow:hidden;border:0.5px solid var(--b1);}
.gp-btn-active{background:var(--ac-bg) !important;border-color:var(--ac-border) !important;color:var(--ac) !important;}
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
.gp-genre-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;}
.gp-genre-card{position:relative;background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:4px;}
.gp-genre-card:hover{border-color:rgba(255,255,255,.16);}
.gp-genre-card-name{font-size:13px;font-weight:500;color:var(--t1);line-height:1.3;padding-right:18px;}
.gp-genre-card-count{font-size:11px;color:var(--t4);}
.gp-genre-card-del{position:absolute;top:7px;right:7px;width:20px;height:20px;border-radius:50%;border:none;background:transparent;color:var(--t4);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;opacity:0;}
.gp-genre-card:hover .gp-genre-card-del{opacity:1;}
.gp-genre-card-del:hover{background:rgba(248,113,113,.15);color:var(--red);}
.gp-settings-section{background:var(--s1);border:0.5px solid var(--b1);border-radius:10px;padding:16px 20px;margin-bottom:14px;}
.gp-settings-section-title{font-size:12px;font-weight:500;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;}
.gp-psb-slideshow{margin:8px 0 6px;}
.gp-psb-progress-bar{height:2px;background:rgba(255,255,255,.1);border-radius:2px;margin-bottom:8px;overflow:hidden;}
.gp-psb-progress-fill{height:100%;background:var(--ac);border-radius:2px;transition:width .1s linear;}
.gp-psb-dots{display:flex;justify-content:center;gap:5px;}
.gp-psb-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.2);cursor:pointer;transition:background .15s;}
.gp-psb-dot.active{background:var(--ac);}
.gp-detail-thread-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:0.5px solid var(--b1);cursor:pointer;}
.gp-detail-thread-row:hover{background:rgba(255,255,255,.03);}
.gp-detail-thread-avatar{width:28px;height:28px;border-radius:var(--av-radius);object-fit:cover;flex-shrink:0;}
.gp-detail-thread-avatar-init{background:rgba(139,92,246,.2);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;color:var(--ac);}
.gp-detail-thread-body{flex:1;min-width:0;}
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
      const max = window._gpMaxLinkedGames || 3;
      if (linkedGames.length >= max) {
        alert(`You can link up to ${max} game${max === 1 ? "" : "s"} per post. Change this in Gamepedia settings.`);
        return;
      }
      openGamePickerModal(
        game => setLinkedGames(prev => {
          if (prev.some(g => g.id === game.id)) return prev;
          if (prev.length >= max) return prev;
          return [...prev, game];
        }),
        linkedGames
      );
    },
  }, 50);

  // post_footer slot — shows linked games below post content
  NE.registerSlot("post_sidebar", PostSidebarGameCard, 200);

  // profile_tab slot — Gamelog tab on user profiles
  // tabLabel is read by Nexus to render the tab label
  GamelogPage.tabLabel = "Gamelog";
  NE.registerSlot("profile_tab", GamelogPage, 50);

  // SPA route — gamelog page
  NE.registerRoute("/ext/gamepedia/gamelog/:user_id", GamelogPage, { title: "Gamelog" });
  NE.registerRoute("/ext/gamepedia/games/:slug", GameDetailPage, { title: "Gamepedia" });
  NE.registerRoute("/ext/gamepedia/browse", GameBrowsePage, { title: "Gamepedia" });

  // Explore sidebar item — use feed page with a marker prop
  // The GameBrowsePage is rendered via the ext-route system when navigated to
  // programmatically from within the SPA (not via URL bar refresh)
  NE.registerExploreItem({
    id:       "gamepedia-browse",
    label:    "Gamepedia",
    icon:     "fa-gamepad",
    page:     "ext-route",
    props:    { _match: NE.matchRoute("/ext/gamepedia/browse") },
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
          { _match: NE.matchRoute(`/ext/gamepedia/gamelog/${user.id}`), user_id: user.id });
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
          { _match: NE.matchRoute(`/ext/gamepedia/games/${n.data.game_slug}`), slug: n.data.game_slug });
    },
  });

})();
