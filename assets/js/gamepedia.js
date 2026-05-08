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

  function GamelogPage({ username, currentUserId }) {
    const React = window.React;
    const { useState, useEffect } = React;

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

  function GamelogProfileLink({ username }) {
    const React = window.React;
    if (!React || !username) return null;

    return React.createElement("a", {
      href:      `/gamepedia/users/${username}`,
      className: "gp-profile-gamelog-link",
      target:    "_blank",
      rel:       "noopener",
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

  // ── Register profile_sidebar slot ───────────────────────────────────────────
  if (window.NexusExtensions) {
    window.NexusExtensions.registerSlot("profile_sidebar", GamelogProfileLink, 50);
  }

  // ── Expose GamelogPage globally for direct embedding ────────────────────────
  window.GamepediaGamelogPage = GamelogPage;

})();
