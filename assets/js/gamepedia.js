/**
 * Gamepedia — Nexus Extension Bundle
 *
 * Registers:
 *   - A gamepad toolbar button in the post composer (via NexusExtensions.registerToolbarButton)
 *   - A post_footer slot component that shows linked games below the post (via NexusExtensions.registerSlot)
 *
 * API calls go to /gamepedia/api/* which Caddy proxies to the Gamepedia service.
 */

(function () {
  "use strict";

  const BASE = "/gamepedia/api";

  // ── Helpers ────────────────────────────────────────────────────────────────

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === "className") node.className = v;
        else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
        else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
      }
    }
    for (const child of children.flat()) {
      if (child == null) continue;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  async function apiFetch(path, opts = {}) {
    const res = await fetch(BASE + path, {
      headers: { "Content-Type": "application/json", ...opts.headers },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ── GamePickerModal ────────────────────────────────────────────────────────
  // A lightweight modal (no React dependency) that searches the Gamepedia
  // library and lets the user pick a game to link to the post.

  function createModal(onSelect, alreadyLinked) {
    let searchTimer = null;

    const overlay = el("div", { className: "gp-modal-overlay" });
    const modal   = el("div", { className: "gp-modal" });

    const header = el("div", { className: "gp-modal-header" },
      el("span", { className: "gp-modal-title" }, "Link a Game"),
      el("button", { className: "gp-modal-close", onclick: close }, "✕")
    );

    const searchInput = el("input", {
      className:   "gp-modal-search",
      type:        "text",
      placeholder: "Search your game library…",
      autofocus:   true,
    });

    const results = el("div", { className: "gp-modal-results" });

    modal.appendChild(header);
    modal.appendChild(searchInput);
    modal.appendChild(results);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Focus input after mount
    setTimeout(() => searchInput.focus(), 50);

    function close() {
      overlay.remove();
    }

    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close();
    });

    document.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
    });

    function renderResults(games) {
      results.innerHTML = "";
      if (games.length === 0) {
        results.appendChild(el("p", { className: "gp-modal-empty" }, "No games found."));
        return;
      }
      for (const game of games) {
        const linked = alreadyLinked.some((g) => g.id === game.id);
        const row = el("button", {
          className: "gp-result-row" + (linked ? " is-linked" : ""),
          onclick:   (e) => {
            e.preventDefault();
            if (!linked) { onSelect(game); close(); }
          },
        },
          game.cover_image_url
            ? el("img", { className: "gp-result-cover", src: game.cover_image_url, alt: game.name })
            : el("div", { className: "gp-result-nocover" }, "🎮"),
          el("div", { className: "gp-result-info" },
            el("div", { className: "gp-result-name" }, game.name),
            game.release_year ? el("div", { className: "gp-result-year" }, String(game.release_year)) : null
          ),
          linked ? el("span", { className: "gp-result-linked" }, "✓ Linked") : null
        );
        results.appendChild(row);
      }
    }

    function doSearch(q) {
      if (!q || q.length < 1) { results.innerHTML = ""; return; }
      results.innerHTML = "<p class='gp-modal-loading'>Searching…</p>";
      apiFetch(`/games?search=${encodeURIComponent(q)}&per_page=20`)
        .then((r) => renderResults(r.data || []))
        .catch(() => { results.innerHTML = "<p class='gp-modal-empty'>Search failed.</p>"; });
    }

    searchInput.addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => doSearch(e.target.value), 300);
    });

    // Show first page of games immediately
    doSearch("");
  }

  // ── Post footer slot component (React component) ──────────────────────────
  // Nexus calls: <GamepediaPostGames postId={42} />
  // Fetches linked games for the post and renders game cards.

  function GamepediaPostGames({ postId }) {
    const React = window.React;
    if (!React) return null;

    const [games,    setGames]    = React.useState(null);
    const [loading,  setLoading]  = React.useState(true);

    React.useEffect(() => {
      if (!postId) return;
      apiFetch(`/posts/${postId}/games`)
        .then((r) => { setGames(r.data || []); setLoading(false); })
        .catch(() => setLoading(false));
    }, [postId]);

    if (loading || !games || games.length === 0) return null;

    return React.createElement("div", { className: "gp-post-games" },
      React.createElement("div", { className: "gp-post-games-label" },
        React.createElement("i", { className: "fa-solid fa-gamepad", style: { marginRight: 6 } }),
        "Linked Games"
      ),
      React.createElement("div", { className: "gp-post-games-list" },
        games.map((game) =>
          React.createElement("a", {
            key:       game.id,
            className: "gp-game-card",
            href:      `/gamepedia/games/${game.slug}`,
            target:    "_blank",
            rel:       "noopener noreferrer",
          },
            game.cover_image_url
              ? React.createElement("img", { src: game.cover_image_url, alt: game.name, className: "gp-game-card-cover" })
              : React.createElement("div", { className: "gp-game-card-nocover" },
                  React.createElement("i", { className: "fa-solid fa-gamepad" })
                ),
            React.createElement("div", { className: "gp-game-card-info" },
              React.createElement("div", { className: "gp-game-card-name" }, game.name),
              game.release_year
                ? React.createElement("div", { className: "gp-game-card-year" }, String(game.release_year))
                : null,
              game.developer
                ? React.createElement("div", { className: "gp-game-card-dev" }, game.developer)
                : null
            )
          )
        )
      )
    );
  }

  // ── CSS ────────────────────────────────────────────────────────────────────

  const style = document.createElement("style");
  style.textContent = `
/* Gamepedia extension styles */

/* Modal overlay */
.gp-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9000;}
.gp-modal{background:#1a1928;border:0.5px solid rgba(255,255,255,.12);border-radius:16px;width:100%;max-width:480px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.6);}
.gp-modal-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:0.5px solid rgba(255,255,255,.08);flex-shrink:0;}
.gp-modal-title{font-size:14px;font-weight:600;color:#e2e0ff;}
.gp-modal-close{background:none;border:none;color:rgba(255,255,255,.4);font-size:18px;cursor:pointer;line-height:1;padding:0;}
.gp-modal-close:hover{color:rgba(255,255,255,.8);}
.gp-modal-search{margin:12px 16px;padding:9px 12px;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;color:#e2e0ff;font-size:13px;outline:none;width:calc(100% - 32px);box-sizing:border-box;}
.gp-modal-search::placeholder{color:rgba(255,255,255,.3);}
.gp-modal-search:focus{border-color:rgba(167,139,250,.5);}
.gp-modal-results{overflow-y:auto;flex:1;padding:0 8px 12px;}
.gp-modal-loading,.gp-modal-empty{font-size:13px;color:rgba(255,255,255,.35);text-align:center;padding:20px;}

/* Search result rows */
.gp-result-row{display:flex;align-items:center;gap:10px;width:100%;background:none;border:none;border-radius:10px;padding:8px 10px;cursor:pointer;text-align:left;transition:background .12s;}
.gp-result-row:hover{background:rgba(255,255,255,.06);}
.gp-result-row.is-linked{opacity:.5;cursor:default;}
.gp-result-cover{width:32px;height:44px;object-fit:cover;border-radius:4px;flex-shrink:0;}
.gp-result-nocover{width:32px;height:44px;background:rgba(255,255,255,.06);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
.gp-result-info{flex:1;min-width:0;}
.gp-result-name{font-size:13px;font-weight:500;color:#e2e0ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.gp-result-year{font-size:11px;color:rgba(255,255,255,.35);margin-top:2px;}
.gp-result-linked{font-size:11px;color:#a78bfa;flex-shrink:0;}

/* Toolbar button */
.gp-toolbar-btn{color:rgba(255,255,255,.7);}
.gp-toolbar-btn:hover{color:#a78bfa;}

/* Post footer game cards */
.gp-post-games{padding:12px 0 6px;border-top:0.5px solid rgba(255,255,255,.06);margin-top:8px;}
.gp-post-games-label{font-size:11px;font-weight:500;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;display:flex;align-items:center;}
.gp-post-games-list{display:flex;flex-wrap:wrap;gap:10px;}
.gp-game-card{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:10px;padding:8px 12px 8px 8px;text-decoration:none;transition:background .12s,border-color .12s;}
.gp-game-card:hover{background:rgba(167,139,250,.08);border-color:rgba(167,139,250,.25);}
.gp-game-card-cover{width:36px;height:48px;object-fit:cover;border-radius:5px;flex-shrink:0;}
.gp-game-card-nocover{width:36px;height:48px;background:rgba(255,255,255,.06);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;color:rgba(255,255,255,.3);}
.gp-game-card-info{min-width:0;}
.gp-game-card-name{font-size:13px;font-weight:500;color:#e2e0ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;}
.gp-game-card-year{font-size:11px;color:rgba(255,255,255,.35);margin-top:1px;}
.gp-game-card-dev{font-size:11px;color:rgba(255,255,255,.3);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;}
`;
  document.head.appendChild(style);

  // ── Register with Nexus ────────────────────────────────────────────────────

  if (window.NexusExtensions) {
    // Register toolbar button using config object — no React component needed
    window.NexusExtensions.registerToolbarButton({
      icon:    "fa-solid fa-gamepad",
      tip:     "Link a game",
      color:   "var(--ac)",
      onClick: function(linkedGames, setLinkedGames) {
        createModal(
          function(game) {
            setLinkedGames(function(prev) {
              if (prev.some(function(g) { return g.id === game.id; })) return prev;
              return prev.concat([game]);
            });
          },
          linkedGames
        );
      },
    }, 50);

    window.NexusExtensions.registerSlot("post_footer", GamepediaPostGames, 50);
  } else {
    console.warn("[Gamepedia] NexusExtensions not found — bundle loaded too early?");
  }

})();

// ─────────────────────────────────────────────────────────────────────────────
// Stage 5 — Gamelog
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  "use strict";

  const BASE = "/gamepedia/api";

  function apiFetch(path, opts = {}) {
    return fetch(BASE + path, {
      headers: { "Content-Type": "application/json", ...opts.headers },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(r => r.json());
  }

  // ── GamelogPage ─────────────────────────────────────────────────────────────
  // Renders at /gamepedia/users/:username
  // Registered in the profile_sidebar slot so it shows as a profile tab link,
  // and as a full page via a custom route handler on the nav_bottom slot.

  function GamelogPage({ username, currentUser, navigate }) {
    const React = window.React;
    const { useState, useEffect } = React;

    const currentUserId = currentUser?.id || null;

    const [data,        setData]        = useState(null);
    const [loading,     setLoading]     = useState(true);
    const [error,       setError]       = useState(null);
    const [page,        setPage]        = useState(1);
    const [sort,        setSort]        = useState("newest");
    const [genre,       setGenre]       = useState("");
    const [search,      setSearch]      = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [playingBusy, setPlayingBusy] = useState(false);
    const searchTimer = React.useRef(null);

    const isOwner = currentUserId && data && currentUserId === data.user?.id;

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

    if (error) return React.createElement("div", { className: "gp-error" }, error);

    const stats = data?.stats;
    const games = data?.data || [];
    const meta  = data?.meta || {};
    const genres = data?.filters?.genres || [];

    return React.createElement("div", { className: "gp-gamelog-page" },

      // Stats bar
      stats && React.createElement("div", { className: "gp-gl-stats" },
        stats.playing && React.createElement("div", { className: "gp-gl-stats-playing" },
          React.createElement("span", { className: "gp-gl-stats-playing-label" }, "Currently playing"),
          React.createElement("span", { className: "gp-gl-stats-playing-name" }, stats.playing.name)
        ),
        React.createElement("div", { className: "gp-gl-stats-row" },
          React.createElement("div", { className: "gp-gl-stat" },
            React.createElement("div", { className: "gp-gl-stat-n" }, stats.total),
            React.createElement("div", { className: "gp-gl-stat-l" }, "games")
          ),
          React.createElement("div", { className: "gp-gl-stat" },
            React.createElement("div", { className: "gp-gl-stat-n" }, stats.added_this_month),
            React.createElement("div", { className: "gp-gl-stat-l" }, "this month")
          ),
          stats.top_genre && React.createElement("div", { className: "gp-gl-stat" },
            React.createElement("div", { className: "gp-gl-stat-n" }, stats.top_genre.name),
            React.createElement("div", { className: "gp-gl-stat-l" }, "top genre")
          ),
          stats.oldest && React.createElement("div", { className: "gp-gl-stat" },
            React.createElement("div", { className: "gp-gl-stat-n" }, stats.oldest.name),
            React.createElement("div", { className: "gp-gl-stat-l" }, "oldest · " + stats.oldest.year)
          )
        )
      ),

      // Filters
      React.createElement("div", { className: "gp-gl-filters" },
        React.createElement("input", {
          className:   "gp-gl-search",
          type:        "text",
          placeholder: "Search games\u2026",
          value:       searchInput,
          onChange:    e => {
            setSearchInput(e.target.value);
            clearTimeout(searchTimer.current);
            searchTimer.current = setTimeout(() => {
              setSearch(e.target.value);
              setPage(1);
              load(1, sort, genre, e.target.value);
            }, 400);
          },
        }),
        genres.length > 1 && React.createElement("select", {
          className: "gp-gl-select",
          value:     genre,
          onChange:  e => { setGenre(e.target.value); setPage(1); load(1, sort, e.target.value, search); },
        },
          React.createElement("option", { value: "" }, "All Genres"),
          genres.map(g => React.createElement("option", { key: g.id, value: g.slug }, g.name))
        ),
        React.createElement("select", {
          className: "gp-gl-select",
          value:     sort,
          onChange:  e => { setSort(e.target.value); setPage(1); load(1, e.target.value, genre, search); },
        },
          React.createElement("option", { value: "newest" }, "Date Added"),
          React.createElement("option", { value: "az"     }, "Name A \u2192 Z"),
          React.createElement("option", { value: "year"   }, "Release Year")
        )
      ),

      loading && React.createElement("div", { className: "gp-loading" },
        React.createElement("i", { className: "fa-solid fa-spinner fa-spin" }), " Loading\u2026"
      ),

      !loading && games.length === 0 && React.createElement("div", { className: "gp-empty" },
        "No games in this Gamelog yet."
      ),

      !loading && games.length > 0 && React.createElement("div", { className: "gp-grid" },
        games.map(game =>
          React.createElement("div", { key: game.id, className: "gp-gl-card" + (game.is_playing ? " is-playing" : "") },
            React.createElement("a", {
              href:      `/gamepedia/games/${game.slug}`,
              className: "gp-gl-card-link",
              target:    "_blank",
              rel:       "noopener",
            },
              game.cover_image_url
                ? React.createElement("img", { src: game.cover_image_url, alt: game.name, className: "gp-gl-card-cover" })
                : React.createElement("div", { className: "gp-gl-card-nocover" },
                    React.createElement("i", { className: "fa-solid fa-gamepad" })
                  ),
              React.createElement("div", { className: "gp-gl-card-info" },
                React.createElement("div", { className: "gp-gl-card-name" }, game.name),
                game.release_year && React.createElement("div", { className: "gp-gl-card-year" }, String(game.release_year)),
                game.is_playing && React.createElement("div", { className: "gp-gl-playing-badge" }, "\u25B6 Playing")
              )
            ),
            isOwner && React.createElement("div", { className: "gp-gl-card-actions" },
              React.createElement("button", {
                className: "gp-gl-btn" + (game.is_playing ? " active" : ""),
                title:     game.is_playing ? "Unmark as playing" : "Mark as playing",
                disabled:  playingBusy,
                onClick:   e => { e.preventDefault(); markPlaying(game); },
              }, React.createElement("i", { className: "fa-solid fa-play" })),
              React.createElement("button", {
                className: "gp-gl-btn gp-gl-btn-remove",
                title:     "Remove from Gamelog",
                onClick:   e => { e.preventDefault(); removeGame(game); },
              }, React.createElement("i", { className: "fa-solid fa-times" }))
            )
          )
        )
      ),

      // Pagination
      !loading && meta.last_page > 1 && React.createElement("div", { className: "gp-pagination" },
        page > 1 && React.createElement("button", {
          className: "gp-page-btn",
          onClick:   () => { const p = page - 1; setPage(p); load(p, sort, genre, search); },
        }, React.createElement("i", { className: "fa-solid fa-chevron-left" }), " Previous"),
        React.createElement("span", { className: "gp-page-info" }, `Page ${page} of ${meta.last_page}`),
        page < meta.last_page && React.createElement("button", {
          className: "gp-page-btn",
          onClick:   () => { const p = page + 1; setPage(p); load(p, sort, genre, search); },
        }, "Next ", React.createElement("i", { className: "fa-solid fa-chevron-right" }))
      )
    );
  }

  // ── AddToGamelogButton — rendered in post_footer for game detail pages ──────
  // The post_footer slot on a post that has a linked game will show this button.
  // But for the game detail page we need a standalone approach — we expose
  // window.GamepediaGamelog so the game detail page JS can call it directly.

  window.GamepediaGamelog = {
    // Called by game detail page when user clicks Add/Remove gamelog button
    toggle: function(gameId, userId, currentState, onDone) {
      if (!userId) return;
      if (currentState) {
        apiFetch(`/gamelog/${gameId}`, { method: "DELETE", body: { user_id: userId } })
          .then(() => onDone(false));
      } else {
        apiFetch("/gamelog", { method: "POST", body: { game_id: gameId, user_id: userId } })
          .then(() => onDone(true));
      }
    },
  };

  // ── Profile sidebar slot — renders a Gamelog link on user profiles ──────────

  function GamelogProfileLink({ username, navigate }) {
    const React = window.React;
    if (!React || !username) return null;

    return React.createElement("button", {
      className: "gp-profile-gamelog-link",
      onClick:   () => navigate && navigate("ext-route", {
        _match: window.NexusExtensions.matchRoute(`/gamepedia/users/${username}`),
        username,
      }),
    },
      React.createElement("i", { className: "fa-solid fa-bookmark", style: { marginRight: 6 } }),
      "Gamelog"
    );
  }

  // ── CSS ─────────────────────────────────────────────────────────────────────

  const style = document.createElement("style");
  style.textContent = `
/* Gamelog page */
.gp-gamelog-page{padding:16px 0;}
.gp-gl-stats{background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:12px;padding:14px 16px;margin-bottom:16px;}
.gp-gl-stats-playing{display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-bottom:10px;border-bottom:0.5px solid rgba(255,255,255,.06);}
.gp-gl-stats-playing-label{font-size:11px;color:var(--ac);font-weight:500;text-transform:uppercase;letter-spacing:.06em;}
.gp-gl-stats-playing-name{font-size:13px;color:var(--t1);font-weight:500;}
.gp-gl-stats-row{display:flex;gap:12px;flex-wrap:wrap;}
.gp-gl-stat{min-width:80px;}
.gp-gl-stat-n{font-size:15px;font-weight:600;color:var(--t1);}
.gp-gl-stat-l{font-size:11px;color:var(--t4);margin-top:1px;}
.gp-gl-filters{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;}
.gp-gl-search{flex:1;min-width:120px;padding:7px 10px;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;color:var(--t1);font-size:13px;outline:none;}
.gp-gl-search::placeholder{color:var(--t4);}
.gp-gl-select{padding:7px 10px;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;color:var(--t1);font-size:13px;outline:none;}
.gp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;}
.gp-gl-card{position:relative;border-radius:10px;overflow:hidden;background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);transition:border-color .12s;}
.gp-gl-card:hover{border-color:rgba(167,139,250,.3);}
.gp-gl-card.is-playing{border-color:var(--ac);}
.gp-gl-card-link{display:block;text-decoration:none;}
.gp-gl-card-cover{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;}
.gp-gl-card-nocover{width:100%;aspect-ratio:3/4;display:flex;align-items:center;justify-content:center;font-size:28px;color:rgba(255,255,255,.2);}
.gp-gl-card-info{padding:8px;}
.gp-gl-card-name{font-size:12px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.gp-gl-card-year{font-size:11px;color:var(--t4);margin-top:2px;}
.gp-gl-playing-badge{font-size:10px;color:var(--ac);margin-top:3px;font-weight:500;}
.gp-gl-card-actions{display:flex;gap:4px;padding:0 6px 6px;}
.gp-gl-btn{background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:6px;color:var(--t3);cursor:pointer;padding:4px 8px;font-size:11px;transition:background .12s,color .12s;}
.gp-gl-btn:hover{background:rgba(255,255,255,.1);color:var(--t1);}
.gp-gl-btn.active{background:rgba(167,139,250,.15);border-color:var(--ac);color:var(--ac);}
.gp-gl-btn-remove:hover{background:rgba(248,113,113,.1);border-color:rgba(248,113,113,.3);color:#f87171;}
.gp-pagination{display:flex;align-items:center;justify-content:center;gap:12px;padding:16px 0;}
.gp-page-btn{background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;color:var(--t2);cursor:pointer;padding:6px 14px;font-size:12px;}
.gp-page-btn:hover{background:rgba(255,255,255,.1);}
.gp-page-info{font-size:12px;color:var(--t4);}
.gp-profile-gamelog-link{display:flex;align-items:center;padding:6px 10px;font-size:13px;color:var(--t2);text-decoration:none;border-radius:8px;transition:background .12s;}
.gp-profile-gamelog-link:hover{background:rgba(255,255,255,.06);color:var(--t1);}
`;
  document.head.appendChild(style);

  // ── Register route and profile sidebar link ────────────────────────────────
  if (window.NexusExtensions) {
    window.NexusExtensions.registerRoute("/gamepedia/users/:username", GamelogPage, { title: "Gamelog" });
    window.NexusExtensions.registerSlot("profile_sidebar", GamelogProfileLink, 50);
  }

})();

// =============================================================================
// Admin Panel
// =============================================================================

(function () {
  "use strict";

  const BASE = "/gamepedia/api";

  function apiFetch(path, opts = {}) {
    return fetch(BASE + path, {
      headers: { "Content-Type": "application/json", ...opts.headers },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(r => r.json());
  }

  // ── AdminPanel ──────────────────────────────────────────────────────────────

  function AdminPanel({ currentUser, navigate }) {
    const React = window.React;
    const { useState, useEffect } = React;

    const [tab,           setTab]          = useState("games");
    const [games,         setGames]         = useState([]);
    const [gamesLoading,  setGamesLoading]  = useState(true);
    const [gamesError,    setGamesError]    = useState(null);
    const [totalGames,    setTotalGames]    = useState(0);
    const [hasMore,       setHasMore]       = useState(false);
    const [currentPage,   setCurrentPage]   = useState(1);
    const [search,        setSearch]        = useState("");
    const [searchInput,   setSearchInput]   = useState("");
    const [genre,         setGenre]         = useState("");
    const [sort,          setSort]          = useState("newest");
    const [filterGenres,  setFilterGenres]  = useState([]);
    const [deleting,      setDeleting]      = useState({});
    const [refreshing,    setRefreshing]    = useState({});
    const [genres,        setGenres]        = useState([]);
    const [genresLoading, setGenresLoading] = useState(true);
    const [newGenreName,  setNewGenreName]  = useState("");
    const [creatingGenre, setCreatingGenre] = useState(false);
    const [stats,         setStats]         = useState(null);
    const [statsLoading,  setStatsLoading]  = useState(false);
    const [showAddModal,  setShowAddModal]  = useState(false);
    const [showGenreModal,setShowGenreModal]= useState(null); // game to edit genres
    const searchTimer = React.useRef(null);

    const [clientId,     setClientId]     = useState(sessionStorage.getItem("gp_cid") || "");
    const [clientSecret, setClientSecret] = useState(sessionStorage.getItem("gp_cs")  || "");

    function getCreds() {
      return { client_id: clientId, client_secret: clientSecret };
    }
    function saveCreds(id, secret) {
      sessionStorage.setItem("gp_cid", id);
      sessionStorage.setItem("gp_cs",  secret);
    }

    function loadGames(page, append) {
      setGamesLoading(true);
      if (!append) setGames([]);
      const params = new URLSearchParams({ page: page || 1, sort });
      if (search) params.set("search", search);
      if (genre)  params.set("genre", genre);
      apiFetch(`/admin/games?${params}`)
        .then(r => {
          setGamesLoading(false);
          setGames(prev => append ? [...prev, ...(r.data || [])] : (r.data || []));
          setTotalGames(r.meta?.total || 0);
          setHasMore(r.meta?.has_more || false);
          setCurrentPage(r.meta?.current_page || 1);
          setFilterGenres(r.filters?.genres || []);
        })
        .catch(() => { setGamesLoading(false); setGamesError("Failed to load games."); });
    }

    function loadGenres() {
      setGenresLoading(true);
      apiFetch("/admin/genres")
        .then(r => { setGenresLoading(false); setGenres(r.data || []); })
        .catch(() => setGenresLoading(false));
    }

    function loadStats() {
      if (statsLoading) return;
      setStatsLoading(true);
      apiFetch("/admin/stats")
        .then(r => { setStats(r.data || null); setStatsLoading(false); })
        .catch(() => setStatsLoading(false));
    }

    useEffect(() => { loadGames(1); loadGenres(); }, []);

    function deleteGame(game) {
      if (!confirm(`Delete "${game.name}"? This cannot be undone.`)) return;
      setDeleting(p => ({ ...p, [game.id]: true }));
      apiFetch(`/admin/games/${game.id}`, { method: "DELETE" })
        .then(() => { setGames(p => p.filter(g => g.id !== game.id)); setTotalGames(p => p - 1); })
        .catch(() => alert("Failed to delete game."))
        .finally(() => setDeleting(p => ({ ...p, [game.id]: false })));
    }

    function refreshGame(game) {
      const { client_id, client_secret } = getCreds();
      if (!client_id) { alert("IGDB credentials not configured in extension settings."); return; }
      setRefreshing(p => ({ ...p, [game.id]: true }));
      apiFetch(`/admin/games/${game.id}/refresh`, { method: "POST", body: { client_id, client_secret } })
        .then(r => {
          if (r.data) setGames(p => p.map(g => g.id === game.id ? { ...g, ...r.data } : g));
          alert(`${game.name} refreshed.`);
        })
        .catch(() => alert(`Failed to refresh ${game.name}.`))
        .finally(() => setRefreshing(p => ({ ...p, [game.id]: false })));
    }

    function createGenre() {
      const name = newGenreName.trim();
      if (!name) return;
      setCreatingGenre(true);
      apiFetch("/admin/genres", { method: "POST", body: { name } })
        .then(r => {
          if (r.data) { setGenres(p => [...p, r.data].sort((a, b) => a.name.localeCompare(b.name))); setNewGenreName(""); }
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

    const e = React.createElement;

    return e("div", { className: "gp-admin" },

      // Tabs
      e("div", { className: "gp-admin-tabs" },
        ["games", "genres", "stats"].map(t =>
          e("button", {
            key:       t,
            className: "gp-admin-tab" + (tab === t ? " active" : ""),
            onClick:   () => { setTab(t); if (t === "stats" && !stats) loadStats(); },
          }, t === "games" ? "🎮 Games" : t === "genres" ? "🏷 Genres" : "📊 Stats")
        )
      ),

      // ── Games tab ───────────────────────────────────────────────────────────
      tab === "games" && e("div", { className: "gp-admin-content" },
        !clientId && e("div", { className: "gp-creds-bar" },
          e("i", { className: "fa-solid fa-key", style: { color: "var(--ac)", marginRight: 8 } }),
          e("span", { style: { fontSize: 12, color: "var(--t3)", marginRight: 12 } }, "Enter IGDB credentials to import or refresh games:"),
          e("input", { className: "gp-admin-search", type: "text", placeholder: "Client ID", style: { width: 160 },
            value: clientId, onChange: ev => { setClientId(ev.target.value); saveCreds(ev.target.value, clientSecret); } }),
          e("input", { className: "gp-admin-search", type: "password", placeholder: "Client Secret", style: { width: 180 },
            value: clientSecret, onChange: ev => { setClientSecret(ev.target.value); saveCreds(clientId, ev.target.value); } })
        ),
        e("div", { className: "gp-admin-toolbar" },
          e("div", { className: "gp-admin-filters" },
            e("input", {
              className:   "gp-admin-search",
              type:        "text",
              placeholder: "Search games…",
              value:       searchInput,
              onChange:    ev => {
                setSearchInput(ev.target.value);
                clearTimeout(searchTimer.current);
                searchTimer.current = setTimeout(() => { setSearch(ev.target.value); loadGames(1); }, 400);
              },
            }),
            e("select", {
              className: "gp-admin-select",
              value:     genre,
              onChange:  ev => { setGenre(ev.target.value); loadGames(1); },
            },
              e("option", { value: "" }, "All Genres"),
              filterGenres.map(g => e("option", { key: g.id, value: g.slug }, g.name))
            ),
            e("select", {
              className: "gp-admin-select",
              value:     sort,
              onChange:  ev => { setSort(ev.target.value); loadGames(1); },
            },
              e("option", { value: "newest" }, "Newest Added"),
              e("option", { value: "oldest" }, "Oldest Added"),
              e("option", { value: "az"     }, "A → Z"),
              e("option", { value: "za"     }, "Z → A")
            )
          ),
          e("button", {
            className: "gp-btn-primary",
            onClick:   () => setShowAddModal(true),
          }, "+ Add Game")
        ),

        !gamesLoading && e("p", { className: "gp-admin-count" }, `${totalGames} game${totalGames !== 1 ? "s" : ""}`),
        gamesLoading && games.length === 0 && e("div", { className: "gp-loading" }, e("i", { className: "fa-solid fa-spinner fa-spin" }), " Loading…"),
        gamesError && e("div", { className: "gp-error" }, gamesError),
        !gamesLoading && games.length === 0 && !gamesError && e("p", { className: "gp-empty" }, "No games yet. Add one above."),

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
                e("button", { className: "gp-admin-btn", title: "Edit genres", onClick: () => setShowGenreModal(game) },
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

      // ── Genres tab ──────────────────────────────────────────────────────────
      tab === "genres" && e("div", { className: "gp-admin-content" },
        e("div", { className: "gp-genre-create" },
          e("input", {
            className:   "gp-admin-search",
            type:        "text",
            placeholder: "New genre name…",
            value:       newGenreName,
            onChange:    ev => setNewGenreName(ev.target.value),
            onKeyDown:   ev => { if (ev.key === "Enter") createGenre(); },
          }),
          e("button", {
            className: "gp-btn-primary",
            disabled:  !newGenreName.trim() || creatingGenre,
            onClick:   createGenre,
          }, creatingGenre ? "Adding…" : "+ Add Genre")
        ),
        genresLoading && e("div", { className: "gp-loading" }, e("i", { className: "fa-solid fa-spinner fa-spin" }), " Loading…"),
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

      // ── Stats tab ───────────────────────────────────────────────────────────
      tab === "stats" && e("div", { className: "gp-admin-content" },
        statsLoading && e("div", { className: "gp-loading" }, e("i", { className: "fa-solid fa-spinner fa-spin" }), " Loading…"),
        !statsLoading && !stats && e("p", { className: "gp-empty" }, "No stats yet."),
        !statsLoading && stats && e("div", { className: "gp-stats" },
          e("div", { className: "gp-stats-grid" },
            [
              { label: "Total Games",       value: stats.total_games },
              { label: "Screenshots",       value: `${stats.total_screenshots} (~${stats.estimated_disk_mb} MB)` },
              { label: "Gamelog Entries",   value: stats.total_gamelogs },
              { label: "No Genre",          value: stats.games_no_genre,   warn: stats.games_no_genre > 0 },
              { label: "No Cover",          value: stats.games_no_cover,   warn: stats.games_no_cover > 0 },
            ].map(s =>
              e("div", { key: s.label, className: "gp-stat-card" + (s.warn ? " warn" : "") },
                e("div", { className: "gp-stat-value" }, String(s.value)),
                e("div", { className: "gp-stat-label" }, s.label)
              )
            )
          ),
          stats.top_gamelog_games?.length > 0 && e("div", { className: "gp-stats-top" },
            e("h4", null, "Most Gamelog'd"),
            e("ol", { className: "gp-stats-top-list" },
              stats.top_gamelog_games.map(g =>
                e("li", { key: g.id },
                  e("span", null, g.name),
                  e("span", { className: "gp-stats-count" }, `${g.gamelog_count} users`)
                )
              )
            )
          ),
          e("button", { className: "gp-btn", onClick: () => { setStats(null); loadStats(); } },
            e("i", { className: "fa-solid fa-sync", style: { marginRight: 6 } }), "Refresh Stats"
          )
        )
      ),

      // ── Add Game Modal ──────────────────────────────────────────────────────
      showAddModal && e(AddGameModal, {
        getCreds,
        onGameAdded: () => loadGames(1),
        onClose:     () => setShowAddModal(false),
        genres,
        onGenresUpdate: updatedGenres => setGenres(updatedGenres),
      }),

      // ── Edit Genres Modal ───────────────────────────────────────────────────
      showGenreModal && e(EditGenresModal, {
        game:    showGenreModal,
        genres,
        onSaved: updatedGame => {
          setGames(p => p.map(g => g.id === updatedGame.id ? updatedGame : g));
          setShowGenreModal(null);
        },
        onClose: () => setShowGenreModal(null),
      })
    );
  }

  // ── AddGameModal ────────────────────────────────────────────────────────────

  function AddGameModal({ getCreds, onGameAdded, onClose, genres, onGenresUpdate }) {
    const React = window.React;
    const { useState } = React;
    const e = React.createElement;

    const [query,   setQuery]   = useState("");
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error,   setError]   = useState(null);
    const [adding,  setAdding]  = useState({});
    const [added,   setAdded]   = useState({});
    const searchTimer = React.useRef(null);

    function doSearch(q) {
      if (!q || q.length < 2) { setResults([]); return; }
      const { client_id, client_secret } = getCreds();
      if (!client_id) { setError("IGDB credentials not configured. Go to Settings → Extensions → Gamepedia."); return; }
      setLoading(true); setError(null);
      fetch(`/gamepedia/api/games/search?q=${encodeURIComponent(q)}&client_id=${encodeURIComponent(client_id)}&client_secret=${encodeURIComponent(client_secret)}`)
        .then(r => r.json())
        .then(r => { setLoading(false); setResults(r.data || []); setError(r.error || null); })
        .catch(() => { setLoading(false); setError("Search failed."); });
    }

    function addGame(game) {
      const { client_id, client_secret } = getCreds();
      setAdding(p => ({ ...p, [game.igdb_id]: true }));
      fetch("/gamepedia/api/admin/games/import", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ igdb_id: game.igdb_id, client_id, client_secret }),
      })
        .then(r => r.json())
        .then(r => {
          setAdding(p => ({ ...p, [game.igdb_id]: false }));
          if (r.error) { setError(r.error); return; }
          setAdded(p => ({ ...p, [game.igdb_id]: true }));
          onGameAdded();
        })
        .catch(() => { setAdding(p => ({ ...p, [game.igdb_id]: false })); setError("Failed to add game."); });
    }

    return e("div", { className: "gp-modal-overlay", onMouseDown: ev => { if (ev.target === ev.currentTarget) onClose(); } },
      e("div", { className: "gp-modal" },
        e("div", { className: "gp-modal-header" },
          e("span", { className: "gp-modal-title" }, "Add Game from IGDB"),
          e("button", { className: "gp-modal-close", onClick: onClose }, "✕")
        ),
        e("input", {
          className:   "gp-modal-search",
          type:        "text",
          placeholder: "Search IGDB…",
          value:       query,
          autoFocus:   true,
          onChange:    ev => {
            setQuery(ev.target.value);
            clearTimeout(searchTimer.current);
            searchTimer.current = setTimeout(() => doSearch(ev.target.value), 500);
          },
        }),
        error && e("div", { className: "gp-modal-error" }, error),
        loading && e("p", { className: "gp-modal-loading" }, e("i", { className: "fa-solid fa-spinner fa-spin" }), " Searching IGDB…"),
        e("div", { className: "gp-modal-results" },
          results.length === 0 && !loading && query.length >= 2 && e("p", { className: "gp-modal-empty" }, "No results."),
          results.map(game =>
            e("div", { key: game.igdb_id, className: "gp-import-row" },
              game.cover_image_url
                ? e("img", { className: "gp-import-cover", src: game.cover_image_url, alt: game.name })
                : e("div", { className: "gp-import-nocover" }, "🎮"),
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
                    }, adding[game.igdb_id] ? "Adding…" : "Add Game")
              )
            )
          )
        )
      )
    );
  }

  // ── EditGenresModal ─────────────────────────────────────────────────────────

  function EditGenresModal({ game, genres, onSaved, onClose }) {
    const React = window.React;
    const { useState } = React;
    const e = React.createElement;

    const [selected, setSelected] = useState(new Set((game.genres || []).map(g => g.id)));
    const [saving,   setSaving]   = useState(false);

    function save() {
      setSaving(true);
      fetch(`/gamepedia/api/admin/games/${game.id}/genres`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ genre_ids: Array.from(selected) }),
      })
        .then(r => r.json())
        .then(() => {
          const updatedGenres = genres.filter(g => selected.has(g.id));
          onSaved({ ...game, genres: updatedGenres });
        })
        .catch(() => alert("Failed to save genres."))
        .finally(() => setSaving(false));
    }

    return e("div", { className: "gp-modal-overlay", onMouseDown: ev => { if (ev.target === ev.currentTarget) onClose(); } },
      e("div", { className: "gp-modal gp-modal-sm" },
        e("div", { className: "gp-modal-header" },
          e("span", { className: "gp-modal-title" }, `Genres — ${game.name}`),
          e("button", { className: "gp-modal-close", onClick: onClose }, "✕")
        ),
        e("div", { className: "gp-genre-checklist" },
          genres.length === 0 && e("p", { className: "gp-modal-empty" }, "No genres yet. Create some in the Genres tab."),
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
            saving ? "Saving…" : "Save Genres"
          )
        )
      )
    );
  }

  // ── CSS ─────────────────────────────────────────────────────────────────────

  const style = document.createElement("style");
  style.textContent = `
.gp-admin{padding:16px 0;}
.gp-creds-bar{display:flex;align-items:center;gap:8px;background:rgba(167,139,250,.06);border:0.5px solid rgba(167,139,250,.2);border-radius:10px;padding:10px 14px;margin-bottom:14px;flex-wrap:wrap;}
.gp-admin-tabs{display:flex;gap:4px;margin-bottom:16px;border-bottom:0.5px solid rgba(255,255,255,.08);padding-bottom:0;}
.gp-admin-tab{background:none;border:none;border-bottom:2px solid transparent;color:var(--t3);cursor:pointer;font-size:13px;padding:8px 14px 10px;transition:color .12s,border-color .12s;}
.gp-admin-tab:hover{color:var(--t1);}
.gp-admin-tab.active{color:var(--ac);border-bottom-color:var(--ac);}
.gp-admin-content{padding-top:4px;}
.gp-admin-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;flex-wrap:wrap;}
.gp-admin-filters{display:flex;gap:6px;flex-wrap:wrap;flex:1;}
.gp-admin-search{flex:1;min-width:140px;padding:7px 10px;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;color:var(--t1);font-size:13px;outline:none;}
.gp-admin-search::placeholder{color:var(--t4);}
.gp-admin-select{padding:7px 10px;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;color:var(--t1);font-size:13px;outline:none;}
.gp-admin-count{font-size:12px;color:var(--t4);margin-bottom:10px;}
.gp-btn{background:rgba(255,255,255,.08);border:0.5px solid rgba(255,255,255,.12);border-radius:8px;color:var(--t2);cursor:pointer;font-size:13px;padding:7px 16px;transition:background .12s;}
.gp-btn:hover{background:rgba(255,255,255,.13);}
.gp-btn-primary{background:var(--ac);border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:13px;font-weight:500;padding:7px 16px;transition:opacity .12s;}
.gp-btn-primary:hover{opacity:.88;}
.gp-btn-primary:disabled{opacity:.4;cursor:default;}
.gp-admin-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;}
.gp-admin-card{background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden;}
.gp-admin-card-cover{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;}
.gp-admin-card-nocover{width:100%;aspect-ratio:3/4;display:flex;align-items:center;justify-content:center;font-size:28px;color:rgba(255,255,255,.2);}
.gp-admin-card-info{padding:8px 8px 4px;}
.gp-admin-card-name{font-size:12px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.gp-admin-card-year{font-size:11px;color:var(--t4);margin-top:1px;}
.gp-admin-card-genres{display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;}
.gp-genre-tag{font-size:10px;background:rgba(167,139,250,.12);color:var(--ac);border-radius:4px;padding:2px 5px;}
.gp-admin-card-actions{display:flex;gap:4px;padding:4px 6px 6px;}
.gp-admin-btn{background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:6px;color:var(--t3);cursor:pointer;flex:1;font-size:11px;padding:5px;transition:background .12s,color .12s;}
.gp-admin-btn:hover{background:rgba(255,255,255,.1);color:var(--t1);}
.gp-admin-btn:disabled{opacity:.4;cursor:default;}
.gp-admin-btn-danger:hover{background:rgba(248,113,113,.1);border-color:rgba(248,113,113,.3);color:#f87171;}
.gp-genre-create{display:flex;gap:8px;margin-bottom:14px;}
.gp-genre-list{display:flex;flex-direction:column;gap:6px;}
.gp-genre-row{display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:8px;padding:8px 12px;}
.gp-genre-row-name{font-size:13px;color:var(--t1);}
.gp-stats{padding-top:4px;}
.gp-stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:20px;}
.gp-stat-card{background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:10px;padding:14px;}
.gp-stat-card.warn{border-color:rgba(251,191,36,.3);background:rgba(251,191,36,.05);}
.gp-stat-value{font-size:20px;font-weight:600;color:var(--t1);margin-bottom:4px;}
.gp-stat-label{font-size:11px;color:var(--t4);}
.gp-stats-top{margin-bottom:16px;}
.gp-stats-top h4{font-size:13px;color:var(--t2);margin-bottom:8px;}
.gp-stats-top-list{padding-left:18px;}
.gp-stats-top-list li{display:flex;justify-content:space-between;font-size:13px;color:var(--t2);padding:3px 0;}
.gp-stats-count{color:var(--t4);font-size:12px;}
.gp-modal-error{font-size:12px;color:#f87171;padding:4px 16px;}
.gp-import-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;transition:background .12s;}
.gp-import-row:hover{background:rgba(255,255,255,.04);}
.gp-import-cover{width:32px;height:44px;object-fit:cover;border-radius:4px;flex-shrink:0;}
.gp-import-nocover{width:32px;height:44px;background:rgba(255,255,255,.06);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
.gp-import-info{flex:1;min-width:0;}
.gp-import-year{font-size:12px;color:var(--t4);}
.gp-import-action{flex-shrink:0;}
.gp-import-done{font-size:12px;color:#4ade80;}
.gp-modal-footer{padding:12px 16px;border-top:0.5px solid rgba(255,255,255,.08);display:flex;justify-content:flex-end;}
.gp-modal-sm{max-width:360px;}
.gp-genre-checklist{padding:8px 16px;max-height:300px;overflow-y:auto;}
.gp-genre-check-row{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;color:var(--t2);cursor:pointer;}
`;
  document.head.appendChild(style);

  // ── Register admin panel route ───────────────────────────────────────────────
  if (window.NexusExtensions) {
    window.NexusExtensions.registerRoute("/gamepedia/admin", AdminPanel, { title: "Gamepedia Admin" });
  }

  // ── Register admin sidebar link ──────────────────────────────────────────────
  function GamepediaAdminLink({ navigate }) {
    const React = window.React;
    if (!React) return null;
    return React.createElement("button", {
      className: "gp-profile-gamelog-link",
      onClick:   () => navigate && navigate("ext-route", {
        _match: window.NexusExtensions.matchRoute("/gamepedia/admin"),
      }),
    },
      React.createElement("i", { className: "fa-solid fa-gamepad", style: { marginRight: 6 } }),
      "Gamepedia"
    );
  }

  if (window.NexusExtensions) {
    window.NexusExtensions.registerSlot("admin_sidebar", GamepediaAdminLink, 90);
  }

})();
