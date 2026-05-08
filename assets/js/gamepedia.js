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

  // ── Composer toolbar button (React component) ─────────────────────────────
  // Nexus calls: <GamepediaToolbarButton linkedGames={[]} setLinkedGames={fn} />

  function GamepediaToolbarButton({ linkedGames, setLinkedGames }) {
    const React = window.React;
    if (!React) return null;

    return React.createElement("button", {
      className: "comp-tb-btn gp-toolbar-btn",
      title:     "Link a game",
      type:      "button",
      onMouseDown: (e) => {
        e.preventDefault();
        createModal(
          (game) => setLinkedGames((prev) => {
            if (prev.some((g) => g.id === game.id)) return prev;
            return [...prev, game];
          }),
          linkedGames
        );
      },
    }, React.createElement("i", { className: "fa-solid fa-gamepad", style: { fontSize: 13 } }));
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

  // Expose picker so the TB_BTNS gamepedia button can open it
  window._gpOpenPicker = createModal;

  if (window.NexusExtensions) {
    window.NexusExtensions.registerSlot("post_footer", GamepediaPostGames, 50);
  } else {
    console.warn("[Gamepedia] NexusExtensions not found — bundle loaded too early?");
  }

})();
