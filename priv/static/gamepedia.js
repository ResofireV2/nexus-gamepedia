/*
 * Gamepedia — Nexus extension bundle.
 *
 * Architecture:
 *   - Routes / right widgets / toolbar buttons / profile tabs are all
 *     declared in manifest.json and bound to components here via
 *     window.NexusExtensions (NE).
 *   - All navigation goes through `window.NexusExtensions.navigate(url)`.
 *   - Composer attachments use the new attach() flow — the toolbar button
 *     opens a picker, then calls attach({kind:"game_link", data:{game_id}})
 *     once per selected game when the user confirms. Persistence happens
 *     server-side in Gamepedia.persist_attachment/3.
 *   - Admin panel uses TabbedPanel + SimpleSettingsPanel from
 *     window.NexusExtensionTemplates. Six tabs: Games / Genres / Stats are
 *     custom UI; Credentials / Digest / Post Sidebar are SimpleSettingsPanel
 *     forms that auto-wire to the top-bar Save button via _nexusAdminSaveFn.
 *   - HTTP credentials are NEVER passed from the client. The server reads
 *     them from extension settings.
 */

(function () {
  "use strict";

  const React = window.React;
  const NE    = window.NexusExtensions;
  const NET   = window.NexusExtensionTemplates;

  if (!React || !NE || !NET) {
    console.warn("[Gamepedia] React / NexusExtensions / NexusExtensionTemplates not available.");
    return;
  }

  const { useState, useEffect, useRef } = React;
  const e = React.createElement;

  const SLUG = "gamepedia";
  const BASE = "/ext/" + SLUG + "/api";
  const { SimpleSettingsPanel, TabbedPanel } = NET;

  // ---------------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------------

  function authHeaders() {
    const token = localStorage.getItem("nexus_token");
    return {
      "Content-Type":  "application/json",
      ...(token ? { "Authorization": "Bearer " + token } : {}),
    };
  }

  function apiFetch(path, opts = {}) {
    return fetch(BASE + path, {
      ...opts,
      headers: { ...authHeaders(), ...(opts.headers || {}) },
      body:    opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(r => r.json());
  }

  // Navigation helper that hits the documented URL form.
  function nav(url) {
    window.NexusExtensions.navigate(url);
  }

  // Read a Gamepedia client-side setting injected via window._gp* by the admin
  // panel. These are convenience caches; the values are still authoritative
  // on the server. Defaults match the admin panel's SimpleSettingsPanel defaults.
  function getMaxLinkedGames()   { return window._gpMaxLinkedGames   || 3; }
  function getSlideshowSeconds() { return window._gpSlideshowSeconds || 5; }

  // ---------------------------------------------------------------------------
  // Game picker modal — opened from the composer toolbar button.
  //
  // Plain DOM (no React) so it can be opened from anywhere without needing a
  // host-managed mount point. The modal manages its own selection state. When
  // the user clicks Add, it calls `onConfirm(games)` with the chosen list,
  // which the toolbar onClick uses to call attach() once per game.
  // ---------------------------------------------------------------------------

  function openGamePickerModal({ onConfirm, max }) {
    let searchTimer = null;
    const selected = new Map(); // id → game

    const overlay = mk("div", { className: "gp-modal-overlay" });
    const modal   = mk("div", { className: "gp-modal" });

    const header = mk("div", { className: "gp-modal-header" },
      mk("span", { className: "gp-modal-title" }, "Link a Game"),
      mkBtn("gp-modal-close", "\u2715", close)
    );

    const input = mk("input", {
      className:   "gp-modal-search",
      type:        "text",
      placeholder: "Search the game library\u2026",
    });

    const results = mk("div", { className: "gp-modal-results" });

    const selectedBar = mk("div", { className: "gp-modal-selected" });

    const footer = mk("div", { className: "gp-modal-footer" });
    const confirmBtn = document.createElement("button");
    confirmBtn.className   = "gp-btn-primary";
    confirmBtn.textContent = "Add 0 games";
    confirmBtn.disabled    = true;
    confirmBtn.addEventListener("click", () => {
      const games = Array.from(selected.values());
      close();
      if (games.length > 0) onConfirm(games);
    });
    footer.appendChild(confirmBtn);

    modal.append(header, input, selectedBar, results, footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    setTimeout(() => input.focus(), 50);

    overlay.addEventListener("mousedown", ev => { if (ev.target === overlay) close(); });
    document.addEventListener("keydown", onKey);

    function onKey(ev) { if (ev.key === "Escape") close(); }
    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    }

    function renderSelected() {
      selectedBar.innerHTML = "";
      if (selected.size === 0) {
        selectedBar.style.display = "none";
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Add 0 games";
        return;
      }
      selectedBar.style.display = "flex";
      for (const game of selected.values()) {
        const pill = mk("span", { className: "gp-modal-selected-pill" }, game.name);
        const x = mk("span", { className: "gp-modal-selected-x" }, "\u2715");
        x.addEventListener("click", () => {
          selected.delete(game.id);
          renderSelected();
          renderResults(lastResults);
        });
        pill.appendChild(x);
        selectedBar.appendChild(pill);
      }
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Add " + selected.size + (selected.size === 1 ? " game" : " games");
    }

    let lastResults = [];

    function renderResults(games) {
      lastResults = games;
      results.innerHTML = "";
      if (!games.length) {
        results.appendChild(mk("p", { className: "gp-modal-empty" }, "No games found."));
        return;
      }
      games.forEach(game => {
        const isSelected = selected.has(game.id);
        const atMax      = !isSelected && selected.size >= max;
        const row = mk("button", {
          className: "gp-result-row" + (isSelected ? " is-linked" : "") + (atMax ? " is-disabled" : "")
        });
        if (game.cover_image_url) {
          const img = document.createElement("img");
          img.className = "gp-result-cover";
          img.src = game.cover_image_url;
          img.alt = game.name;
          row.appendChild(img);
        } else {
          const nc = mk("div", { className: "gp-result-nocover" });
          nc.innerHTML = '<i class="fa-solid fa-gamepad"></i>';
          row.appendChild(nc);
        }
        const info = mk("div", { className: "gp-result-info" },
          mk("div", { className: "gp-result-name" }, game.name)
        );
        if (game.release_year) info.appendChild(mk("div", { className: "gp-result-year" }, String(game.release_year)));
        row.appendChild(info);
        if (isSelected) row.appendChild(mk("span", { className: "gp-result-linked" }, "\u2713 Selected"));
        row.addEventListener("mousedown", ev => {
          ev.preventDefault();
          if (atMax) return;
          if (isSelected) selected.delete(game.id);
          else            selected.set(game.id, { id: game.id, name: game.name, slug: game.slug });
          renderSelected();
          renderResults(lastResults);
        });
        results.appendChild(row);
      });
    }

    function doSearch(q) {
      results.innerHTML = "<p class='gp-modal-loading'>Searching\u2026</p>";
      apiFetch("/games?per_page=20" + (q ? "&search=" + encodeURIComponent(q) : ""))
        .then(r => renderResults(r.data || []))
        .catch(() => { results.innerHTML = "<p class='gp-modal-empty'>Search failed.</p>"; });
    }

    input.addEventListener("input", ev => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => doSearch(ev.target.value), 300);
    });

    renderSelected();
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
    b.className   = cls;
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }

  // ---------------------------------------------------------------------------
  // PostSidebarGameCard — right_widget bound to id "gamepedia-post-card".
  // Scope: corePages:["post"]. Receives {currentUser, pageProps}.
  // pageProps.id is the post id when rendered on /post/:id.
  // ---------------------------------------------------------------------------

  function PostSidebarGameCard({ currentUser, pageProps }) {
    const postId = pageProps?.id;
    const [games,       setGames]       = useState([]);
    const [gameDetails, setGameDetails] = useState({});
    const [gamelogIds,  setGamelogIds]  = useState({});
    const [logBusy,     setLogBusy]     = useState({});
    const [activeIdx,   setActiveIdx]   = useState(0);
    const [progress,    setProgress]    = useState(0);
    const startRef = useRef(null);
    const rafRef   = useRef(null);

    const interval = getSlideshowSeconds() * 1000;

    useEffect(() => {
      if (!postId) return;
      setGames([]); setGameDetails({}); setGamelogIds({}); setActiveIdx(0); setProgress(0);

      apiFetch("/posts/" + postId + "/games")
        .then(r => {
          const list = r.data || [];
          setGames(list);
          list.forEach(g => {
            apiFetch("/games/" + g.slug)
              .then(gr => { if (gr.data) setGameDetails(p => ({ ...p, [g.id]: gr.data })); })
              .catch(() => setGameDetails(p => ({ ...p, [g.id]: g })));
          });
          if (currentUser?.id && list.length > 0) {
            apiFetch("/gamelog/" + currentUser.id)
              .then(gr => {
                const map = {};
                (gr.data || []).forEach(x => { map[x.id] = true; });
                setGamelogIds(map);
              })
              .catch(() => {});
          }
        })
        .catch(() => {});
    }, [postId]);

    // Slideshow loop using requestAnimationFrame for smooth progress.
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
      return () => cancelAnimationFrame(rafRef.current);
    }, [games.length]);

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
          if (pct < 1) {
            rafRef.current = requestAnimationFrame(tick);
          } else {
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
    const inGamelog = !!gamelogIds[game.id];
    const awards = game.awards || [];

    function toggleGamelog() {
      if (!currentUser || !game) return;
      setLogBusy(p => ({ ...p, [game.id]: true }));
      const finish = ok => setGamelogIds(p => ({ ...p, [game.id]: ok })) ||
                          setLogBusy(p => ({ ...p, [game.id]: false }));
      if (inGamelog) {
        apiFetch("/gamelog/" + game.id, { method: "DELETE" })
          .then(() => finish(false))
          .catch(() => setLogBusy(p => ({ ...p, [game.id]: false })));
      } else {
        apiFetch("/gamelog", { method: "POST", body: { game_id: game.id } })
          .then(() => finish(true))
          .catch(() => setLogBusy(p => ({ ...p, [game.id]: false })));
      }
    }

    function goToGame() {
      if (game) nav("/ext/" + SLUG + "/games/" + game.slug);
    }

    return e("div", { className: "gp-psb" },
      e("div", { className: "gp-rw-label" },
        games.length > 1 ? "linked games (" + (activeIdx + 1) + "/" + games.length + ")" : "linked game"
      ),

      // Cover with gradient overlay and bottom-mounted genres/name/sub
      e("div", { className: "gp-psb-cover-wrap", onClick: goToGame },
        game.cover_image_url
          ? e("img", { src: game.cover_image_url, alt: game.name, className: "gp-psb-cover-img" })
          : e("div", { className: "gp-psb-cover-empty" }, e("i", { className: "fa-solid fa-gamepad" })),
        e("div", { className: "gp-psb-overlay" }),
        e("div", { className: "gp-psb-cover-bottom" },
          game.genres && game.genres.length > 0 && e("div", { className: "gp-psb-genres" },
            game.genres.slice(0, 2).map(g => e("span", { key: g.id, className: "gp-psb-genre-pill" }, g.name))
          ),
          e("div", { className: "gp-psb-name" }, game.name),
          e("div", { className: "gp-psb-sub" },
            [game.developer, game.publisher, game.release_year].filter(Boolean).map(String).slice(0, 2).join(" \u00b7 ")
          )
        )
      ),

      // Slideshow progress bar + dots (only when >1 linked game)
      games.length > 1 && e("div", { className: "gp-psb-slideshow" },
        e("div", { className: "gp-psb-progress-bar" },
          e("div", { className: "gp-psb-progress-fill", style: { width: (progress * 100) + "%" } })
        ),
        e("div", { className: "gp-psb-dots" },
          games.map((_, i) => e("div", {
            key:       i,
            className: "gp-psb-dot" + (i === activeIdx ? " active" : ""),
            onClick:   () => goTo(i),
          }))
        )
      ),

      // Awards row — chip-style with year subscript
      awards.length > 0 && e("div", { className: "gp-psb-awards" },
        awards.slice(0, 2).map(a => e("div", { key: a.id, className: "gp-psb-award" },
          e("i", { className: "fa-solid fa-trophy", style: { fontSize: 9, marginRight: 4 } }),
          a.title,
          a.year && e("span", { className: "gp-psb-award-year" }, a.year)
        ))
      ),

      // 3-stat horizontal row: rating / gamelogs / threads
      e("div", { className: "gp-psb-stats" },
        e("div", { className: "gp-psb-stat" },
          e("div", { className: "gp-psb-stat-n" },
            game.rating_avg
              ? e("span", null,
                  e("i", { className: "fa-solid fa-star", style: { fontSize: 10, marginRight: 2, color: "#a78bfa" } }),
                  game.rating_avg.toFixed(1))
              : e("span", { style: { fontSize: 10 } }, "—")
          ),
          e("div", { className: "gp-psb-stat-l" }, "rating")
        ),
        e("div", { className: "gp-psb-stat" },
          e("div", { className: "gp-psb-stat-n" }, game.gamelog_count != null ? game.gamelog_count : "—"),
          e("div", { className: "gp-psb-stat-l" }, "gamelogs")
        ),
        e("div", { className: "gp-psb-stat" },
          e("div", { className: "gp-psb-stat-n" }, game.thread_count != null ? game.thread_count : "—"),
          e("div", { className: "gp-psb-stat-l" }, "threads")
        )
      ),

      // "View in Gamepedia" button — the primary CTA to open the game detail page
      e("div", { className: "gp-psb-btn gp-psb-btn-view", onClick: goToGame },
        "View in Gamepedia ",
        e("i", { className: "fa-solid fa-arrow-right", style: { fontSize: 10 } })
      ),

      // "Add to / In Gamelog" toggle (only when logged in)
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
  // GamelogTab — profile_tabs[id="gamelog"] component.
  // Receives {username, current_user} per the profile_tab contract.
  // Fetches via /users/:username/gamelog.
  // ---------------------------------------------------------------------------

  function GamelogTab({ username, current_user }) {
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

    const isOwner = !!(data && data.is_owner);

    function load(p, s, g, q) {
      setLoading(true);
      const params = new URLSearchParams({ page: p, sort: s });
      if (g) params.set("genre", g);
      if (q) params.set("search", q);
      apiFetch("/users/" + encodeURIComponent(username) + "/gamelog?" + params)
        .then(r => {
          if (r.error) { setError(r.error); setLoading(false); return; }
          setData(r);
          setLoading(false);
        })
        .catch(() => { setError("Failed to load gamelog."); setLoading(false); });
    }

    useEffect(() => { load(1, sort, genre, search); }, [username]);

    function removeGame(game) {
      apiFetch("/gamelog/" + game.id, { method: "DELETE" })
        .then(() => load(page, sort, genre, search));
    }

    function markPlaying(game) {
      if (playingBusy) return;
      setPlayingBusy(true);
      apiFetch("/gamelog/" + game.id + "/playing", { method: "POST", body: {} })
        .then(() => load(page, sort, genre, search))
        .finally(() => setPlayingBusy(false));
    }

    if (loading && !data) return e("div", { className: "gp-loading" },
      e("i", { className: "fa-solid fa-spinner fa-spin" }), " Loading\u2026"
    );
    if (error) return e("div", { className: "gp-error" }, error);
    if (!data) return null;

    const games  = data.data || [];
    const stats  = data.stats;
    const genres = data.filters?.genres || [];
    const total  = data.meta?.total || 0;

    return e("div", { className: "gp-gamelog-page" },
      // Stats: Currently playing banner (when set) + 4-card grid with icons.
      // Field names match backend (Gamepedia.Gamelogs.stats/1):
      //   stats.total              integer
      //   stats.added_this_month   integer
      //   stats.playing            %{id, name, release_year} | nil
      //   stats.top_genre          %{name, count} | nil
      //   stats.oldest             %{name, year} | nil
      stats && e("div", { className: "gp-gl-stats" },
        stats.playing && e("div", { className: "gp-gl-stats-playing" },
          e("i", { className: "fa-solid fa-play", style: { fontSize: 10, color: "var(--ac)" } }),
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
            e("div", { className: "gp-gl-stat-n" }, stats.top_genre ? stats.top_genre.name : "\u2014"),
            e("div", { className: "gp-gl-stat-l" }, "Top genre")
          ),
          e("div", { className: "gp-gl-stat-card" },
            e("div", { className: "gp-gl-stat-icon", style: { background: "rgba(251,191,36,.12)", color: "#fbbf24" } },
              e("i", { className: "fa-solid fa-clock-rotate-left", style: { fontSize: 13 } })
            ),
            e("div", { className: "gp-gl-stat-n" }, stats.oldest ? stats.oldest.name : "\u2014"),
            e("div", { className: "gp-gl-stat-l" }, stats.oldest ? "Oldest \u00b7 " + stats.oldest.year : "Oldest")
          )
        )
      ),
      e("div", { className: "gp-gl-filters" },
        e("input", {
          className:   "gp-input",
          type:        "text",
          placeholder: "Search gamelog\u2026",
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
          options:  [{ value: "", label: "All Genres" }, ...genres.map(g => ({ value: g.slug, label: g.name }))],
        }),
        e(GpDropdown, {
          value:    sort,
          onChange: v => { setSort(v); setPage(1); load(1, v, genre, search); },
          options:  [
            { value: "newest", label: "Newest" },
            { value: "az",     label: "A → Z" },
            { value: "year",   label: "By year" },
          ],
        })
      ),
      e("div", { className: "gp-gl-count" }, total + " game" + (total === 1 ? "" : "s")),
      games.length === 0
        ? e("div", { className: "gp-empty" },
            isOwner ? "Your gamelog is empty. Browse games to add some!" : "No games in this gamelog.")
        : e("div", { className: "gp-gl-grid" },
            games.map(g => e("div", { key: g.id, className: "gp-gl-card" },
              g.cover_image_url
                ? e("img", {
                    src: g.cover_image_url, alt: g.name,
                    className: "gp-gl-cover",
                    style: { cursor: "pointer" },
                    onClick: () => nav("/ext/" + SLUG + "/games/" + g.slug),
                  })
                : e("div", { className: "gp-gl-cover gp-gl-cover-empty" },
                    e("i", { className: "fa-solid fa-gamepad" })),
              e("div", { className: "gp-gl-card-info" },
                e("div", { className: "gp-gl-card-name",
                  onClick: () => nav("/ext/" + SLUG + "/games/" + g.slug) }, g.name),
                g.release_year && e("div", { className: "gp-gl-card-year" }, g.release_year),
                e("div", { className: "gp-gl-card-added" }, "Added " + g.added_at),
                g.is_playing && e("div", { className: "gp-gl-card-playing" },
                  e("i", { className: "fa-solid fa-circle-play", style: { marginRight: 5 } }), "Currently playing"),
                isOwner && e("div", { className: "gp-gl-card-actions" },
                  e("button", {
                    className: "gp-btn-sm" + (g.is_playing ? " gp-btn-active" : ""),
                    disabled:  playingBusy,
                    onClick:   () => markPlaying(g),
                  }, g.is_playing ? "Stop playing" : "Mark playing"),
                  e("button", {
                    className: "gp-btn-sm gp-btn-danger",
                    onClick:   () => removeGame(g),
                  }, "Remove")
                )
              )
            ))
          )
    );
  }

  // ---------------------------------------------------------------------------
  // NowPlayingWidget — right_widget bound to id "gamepedia-now-playing".
  // Shows games the current user has marked as currently playing.
  // ---------------------------------------------------------------------------

  function NowPlayingWidget({ currentUser }) {
    const [game,    setGame]    = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      if (!currentUser?.id) { setLoading(false); return; }
      apiFetch("/gamelog/" + currentUser.id + "?sort=newest&page=1")
        .then(r => {
          const playing = (r.data || []).find(g => g.is_playing) || null;
          setGame(playing);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }, [currentUser?.username]);

    if (!currentUser) return null;
    if (loading) return e("div", { className: "rw" },
      e("div", { className: "rw-label" }, "Now Playing"),
      e("div", { style: { textAlign: "center", padding: 12, color: "var(--t5)" } },
        e("i", { className: "fa-solid fa-spinner fa-spin" })
      )
    );
    if (!game) return null;

    return e("div", { className: "rw" },
      e("div", { className: "rw-label" }, "Now Playing"),
      e("div", {
        className: "gp-now-playing",
        style:     { cursor: "pointer" },
        onClick:   () => nav("/ext/" + SLUG + "/games/" + game.slug),
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
      )
    );
  }

  // ---------------------------------------------------------------------------
  // GameDetailPage — route /games/:slug
  // ---------------------------------------------------------------------------

  function GameDetailPage({ slug, currentUser }) {
    const [game,        setGame]        = useState(null);
    const [loading,     setLoading]     = useState(true);
    const [error,       setError]       = useState(null);
    const [posts,       setPosts]       = useState([]);
    const [postDetails, setPostDetails] = useState({});
    const [inGamelog,   setInGamelog]   = useState(false);
    const [isPlaying,   setIsPlaying]   = useState(false);
    const [logBusy,     setLogBusy]     = useState(false);
    const [userRating,  setUserRating]  = useState(0);
    const [hoverRating, setHoverRating] = useState(0);
    const [ratingBusy,  setRatingBusy]  = useState(false);
    const [ratingAvg,   setRatingAvg]   = useState(null);
    const [ratingCount, setRatingCount] = useState(0);
    const [ratingDist,  setRatingDist]  = useState([]);

    useEffect(() => {
      if (!slug) return;
      setLoading(true);
      setUserRating(0); setRatingAvg(null); setRatingCount(0); setRatingDist([]);
      setInGamelog(false); setIsPlaying(false); setPosts([]); setPostDetails({});

      apiFetch("/games/" + encodeURIComponent(slug))
        .then(r => {
          if (r.error) { setError(r.error); setLoading(false); return; }
          const g = r.data;
          setGame(g);
          setLoading(false);
          if (g.rating_avg   !== undefined) setRatingAvg(g.rating_avg);
          if (g.rating_count !== undefined) setRatingCount(g.rating_count);
          if (g.rating_distribution)        setRatingDist(g.rating_distribution);
          if (g.user_rating)                setUserRating(g.user_rating);

          if (g.id) {
            apiFetch("/games/" + g.id + "/posts")
              .then(pr => {
                const ids = pr.data || [];
                setPosts(ids);
                ids.forEach(postId => {
                  fetch("/api/v1/posts/" + postId, { headers: authHeaders() })
                    .then(res => res.json())
                    .then(pd => { if (pd.post) setPostDetails(prev => ({ ...prev, [postId]: pd.post })); })
                    .catch(() => {});
                });
              });
          }

          if (currentUser?.id && g.id) {
            apiFetch("/gamelog/" + currentUser.id)
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
        apiFetch("/gamelog/" + game.id, { method: "DELETE" })
          .then(() => { setInGamelog(false); setIsPlaying(false); })
          .finally(() => setLogBusy(false));
      } else {
        apiFetch("/gamelog", { method: "POST", body: { game_id: game.id } })
          .then(() => setInGamelog(true))
          .finally(() => setLogBusy(false));
      }
    }

    function togglePlaying() {
      apiFetch("/gamelog/" + game.id + "/playing", { method: "POST", body: {} })
        .then(r => { if (r.ok) setIsPlaying(r.is_playing); });
    }

    function submitRating(stars) {
      if (!currentUser || ratingBusy) return;
      setRatingBusy(true);
      if (userRating === stars) {
        apiFetch("/games/" + game.id + "/rate", { method: "DELETE" })
          .then(r => {
            if (r.ok) {
              setUserRating(0);
              if (r.summary) {
                setRatingAvg(r.summary.avg);
                setRatingCount(r.summary.count);
                if (r.summary.distribution) setRatingDist(r.summary.distribution);
              }
            }
          })
          .finally(() => setRatingBusy(false));
      } else {
        apiFetch("/games/" + game.id + "/rate", { method: "POST", body: { rating: stars } })
          .then(r => {
            if (r.ok) {
              setUserRating(stars);
              if (r.summary) {
                setRatingAvg(r.summary.avg);
                setRatingCount(r.summary.count);
                if (r.summary.distribution) setRatingDist(r.summary.distribution);
              }
            }
          })
          .finally(() => setRatingBusy(false));
      }
    }

    if (loading) return e("div", { className: "gp-loading" },
      e("i", { className: "fa-solid fa-spinner fa-spin" }), " Loading\u2026"
    );
    if (error) return e("div", { className: "gp-error" }, error);
    if (!game) return null;

    const heroUrl = game.screenshots?.[0]?.webp_url
                 || game.screenshots?.[0]?.url?.replace("t_screenshot_big", "t_screenshot_huge")
                 || null;
    const awards = game.awards || [];

    return e("div", { className: "gp-detail" },
      // Hero
      e("div", { className: "gp-detail-hero", style: heroUrl ? {} : { minHeight: 160 } },
        heroUrl && e("img", { src: heroUrl, alt: "", className: "gp-detail-hero-img" }),
        e("div", { className: "gp-detail-hero-overlay" }),
        e("div", { className: "gp-detail-hero-content" },
          e("div", { style: { display: "flex", flexDirection: "column", flexShrink: 0, alignSelf: "flex-start" } },
            game.cover_image_url
              ? e("img", { src: game.cover_image_url, alt: game.name, className: "gp-detail-cover" })
              : e("div", { className: "gp-detail-cover gp-detail-cover-empty" },
                  e("i", { className: "fa-solid fa-gamepad" }))
          ),
          e("div", { style: { flex: 1, minWidth: 0 } },
            game.genres?.length > 0 && e("div", { className: "gp-detail-genres" },
              game.genres.map(g => e("span", { key: g.id, className: "gp-genre-tag" }, g.name))
            ),
            e("h1", { className: "gp-detail-title" }, game.name),
            e("div", { className: "gp-detail-sub" },
              [game.developer, game.publisher, game.release_year].filter(Boolean).join(" \u00b7 ")
            ),
            game.summary && e("p", { className: "gp-detail-summary" }, game.summary),

            // Awards ribbon — gold trophy chips listing every award attached
            // to this game. Shown alongside the title rather than only in the
            // body's "Awards & recognition" section, so the accolade is the
            // first thing a viewer notices in the header.
            awards.length > 0 && e("div", { className: "gp-detail-hero-awards" },
              awards.map(a => e("span", { key: a.id, className: "gp-detail-hero-award" },
                e("i", { className: "fa-solid fa-trophy", style: { fontSize: 10 } }),
                a.title,
                a.year && e("span", { className: "gp-detail-hero-award-year" }, a.year)
              ))
            ),

            currentUser && e("div", { className: "gp-detail-actions" },
              e("button", {
                className: "gp-btn-primary" + (inGamelog ? " gp-btn-active" : ""),
                disabled:  logBusy,
                onClick:   toggleGamelog,
              },
                e("i", { className: "fa-solid " + (inGamelog ? "fa-check" : "fa-plus"), style: { marginRight: 6 } }),
                inGamelog ? "In your gamelog" : "Add to gamelog"
              ),
              inGamelog && e("button", {
                className: "gp-btn" + (isPlaying ? " gp-btn-active" : ""),
                onClick:   togglePlaying,
              },
                e("i", { className: "fa-solid fa-circle-play", style: { marginRight: 6 } }),
                isPlaying ? "Currently playing" : "Mark playing"
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
                      "/ 5 \u00B7 " + ratingCount + " rating" + (ratingCount === 1 ? "" : "s")
                    )
                  : e("span", { style: { fontSize: 12, color: "rgba(255,255,255,.3)" } }, "No ratings yet")
              ),
              currentUser && e("div", { style: { marginTop: 10 } },
                e("div", { style: { fontSize: 11, color: "rgba(255,255,255,.4)", marginBottom: 6 } },
                  userRating > 0 ? "Your rating: " + userRating + "/5 \u00b7 click again to remove" : "Rate this game:"
                ),
                e(StarRow, {
                  value:   userRating,
                  hover:   hoverRating,
                  size:    24,
                  onHover: setHoverRating,
                  onLeave: () => setHoverRating(0),
                  onClick: submitRating,
                })
              ),
              ratingDist && ratingDist.length > 0 && ratingCount >= 3 && e(RatingDistBar, { distribution: ratingDist })
            )
          )
        )
      ),

      // Trailer — Nexus core ships the .yt-lite facade. A global click
      // listener in nexus.jsx (line 101) intercepts clicks on .yt-lite,
      // reads data-id, and appends the YouTube iframe. We just emit the
      // markup; host handles activation. Saves loading the YouTube iframe
      // (and ~1MB of YT JS) until the user actually clicks.
      game.trailer_youtube_id && e("div", { className: "gp-detail-section" },
        e("div", { className: "gp-detail-section-title" }, "Trailer"),
        e("div", {
          className: "yt-lite",
          "data-id": game.trailer_youtube_id,
        },
          e("img", {
            className: "yt-thumb",
            src:       "https://i.ytimg.com/vi/" + game.trailer_youtube_id + "/maxresdefault.jpg",
            alt:       game.name + " trailer",
            loading:   "lazy",
            onError:   ev => { ev.target.src = "https://i.ytimg.com/vi/" + game.trailer_youtube_id + "/hqdefault.jpg"; },
          }),
          e("div", { className: "yt-play" },
            e("svg", { height: "48", viewBox: "0 0 68 48", width: "68", xmlns: "http://www.w3.org/2000/svg" },
              e("path", { d: "M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55c-2.93.78-4.63 3.26-5.42 6.19C.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z", fill: "#f00" }),
              e("path", { d: "M45 24 27 14v20", fill: "#fff" })
            )
          )
        )
      ),

      // Forum discussions — list of post threads linked to this game.
      // Each row shows avatar, post title, author username, and reply count.
      posts.length > 0 && e("div", { className: "gp-detail-section" },
        e("div", { className: "gp-detail-section-title" }, "Forum discussions"),
        e("div", { className: "gp-detail-threads" },
          posts.map(postId => {
            const pd = postDetails[postId];
            const author   = pd?.user;
            const initials = author?.username ? author.username.slice(0, 2).toUpperCase() : "?";
            return e("div", {
              key:       postId,
              className: "gp-detail-thread-row",
              onClick:   () => nav("/post/" + postId),
            },
              author?.avatar_url
                ? e("img", { src: author.avatar_url, className: "gp-detail-thread-avatar", alt: author.username })
                : e("div", { className: "gp-detail-thread-avatar gp-detail-thread-avatar-init" }, initials),
              e("div", { className: "gp-detail-thread-body" },
                e("span", { className: "gp-detail-thread-name" },
                  pd ? (pd.title || "(untitled)") : "Post #" + postId
                ),
                pd && e("span", { className: "gp-detail-thread-meta" },
                  author ? author.username + " \u00b7 " : "",
                  (pd.reply_count || 0) + " repl" + (pd.reply_count === 1 ? "y" : "ies")
                )
              )
            );
          })
        )
      ),

      // Game info — single rounded card with key/value rows separated by
      // hairline dividers. Mirrors the original .gp-detail-info-block layout.
      e("div", { className: "gp-detail-section" },
        e("div", { className: "gp-detail-section-title" }, "Game info"),
        e("div", { className: "gp-detail-info-block" },
          [
            game.developer     && { key: "Developer",   val: game.developer },
            game.publisher     && { key: "Publisher",   val: game.publisher },
            game.release_year  && { key: "Released",    val: String(game.release_year) },
            (game.gamelog_count > 0) && { key: "In gamelogs",
              val: game.gamelog_count + " member" + (game.gamelog_count === 1 ? "" : "s") },
            (game.thread_count > 0) && { key: "Threads",
              val: game.thread_count + " thread" + (game.thread_count === 1 ? "" : "s") },
          ].filter(Boolean).map(row =>
            e("div", { key: row.key, className: "gp-detail-info-row" },
              e("span", { className: "gp-detail-info-key" }, row.key),
              e("span", { className: "gp-detail-info-val" }, row.val)
            )
          ),
          game.genres && game.genres.length > 0 && e("div", { className: "gp-detail-info-row" },
            e("span", { className: "gp-detail-info-key" }, "Genres"),
            e("div", { style: { display: "flex", gap: 4, flexWrap: "wrap" } },
              game.genres.map(g => e("span", { key: g.id, className: "gp-genre-tag" }, g.name))
            )
          )
        )
      ),

      // Awards
      awards.length > 0 && e("div", { className: "gp-detail-section" },
        e("div", { className: "gp-detail-section-title" }, "Awards & recognition"),
        e("div", { className: "gp-detail-awards" },
          awards.map(a => e("div", { key: a.id, className: "gp-award" },
            e("i", { className: "fa-solid fa-trophy", style: { color: "#fbbf24", marginRight: 8 } }),
            e("strong", null, a.title),
            a.year && e("span", { className: "gp-award-year" }, " (" + a.year + ")")
          ))
        )
      ),

      // Screenshots — clicking opens the Nexus core Fancybox lightbox. The
      // host's auto-click handler at nexus.jsx:369 only matches `.md-body img`,
      // so we wire the click ourselves via window._openFancybox (exported at
      // line 248). Falls back gracefully if the host hasn't loaded yet.
      game.screenshots && game.screenshots.length > 0 && e("div", { className: "gp-detail-section" },
        e("div", { className: "gp-detail-section-title" }, "Screenshots"),
        e("div", { className: "gp-detail-screens" },
          game.screenshots.map((s, idx) => e("img", {
            key:       s.id,
            src:       s.webp_url || s.jpg_url || s.url,
            alt:       "",
            className: "gp-detail-screen",
            loading:   "lazy",
            "data-original": s.url,
            onClick:   () => {
              if (typeof window._openFancybox !== "function") return;
              const items = game.screenshots.map(sh => ({
                src:         sh.webp_url || sh.jpg_url || sh.url,
                originalSrc: sh.url,
              }));
              window._openFancybox(items, idx);
            },
          }))
        )
      )
    );
  }

  // RatingDistBar — small bar chart showing the distribution of 1-5 star
  // ratings. Each bar is `count / max * height`. Tooltip on hover shows the
  // exact "N/5: M ratings" breakdown. Mirrors the original bundle.
  function RatingDistBar({ distribution }) {
    if (!distribution || !distribution.length) return null;
    const max = Math.max.apply(null, distribution.map(d => d.count).concat([1]));
    return e("div", { style: { display: "flex", alignItems: "flex-end", gap: 2, height: 32, marginTop: 8 } },
      distribution.map(d => e("div", {
        key:   d.score,
        title: d.score + "/5: " + d.count + " rating" + (d.count === 1 ? "" : "s"),
        style: {
          flex:       1,
          height:     d.count > 0 ? Math.max(4, Math.round((d.count / max) * 32)) + "px" : "100%",
          background: d.count > 0 ? "var(--ac)" : "rgba(255,255,255,.05)",
          borderRadius: 2,
          transition: "height .2s",
        },
      }))
    );
  }

  // StarRow — 5-star rating control. Sends the integer 1-5 to the backend
  // (Gamepedia.Ratings guards `rating >= 1 and rating <= 5`). The original
  // bundle used 5 stars; sending 6-10 produces `:invalid_rating` and silently
  // fails to record the rating.
  function StarRow({ value, onHover, onLeave, onClick, hover, size }) {
    const sz = size || 22;
    return e("div", { className: "gp-stars", onMouseLeave: onLeave },
      [1, 2, 3, 4, 5].map(s => {
        const filled = s <= (hover || value);
        return e("i", {
          key:          s,
          className:    filled ? "fa-solid fa-star" : "fa-regular fa-star",
          style:        {
            fontSize:   sz,
            color:      filled ? "#a78bfa" : "rgba(255,255,255,.2)",
            cursor:     onClick ? "pointer" : "default",
            transition: "color .1s",
          },
          onMouseEnter: onHover ? () => onHover(s) : undefined,
          onClick:      onClick ? () => onClick(s) : undefined,
        });
      })
    );
  }

  // ---------------------------------------------------------------------------
  // GameBrowsePage — route /browse
  // ---------------------------------------------------------------------------

  function GameBrowsePage({ currentUser, genre: initialGenre }) {
    const [games,       setGames]       = useState([]);
    const [loading,     setLoading]     = useState(true);
    const [total,       setTotal]       = useState(0);
    const [page,        setPage]        = useState(1);
    const [hasMore,     setHasMore]     = useState(false);
    const [search,      setSearch]      = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [genres,      setGenres]      = useState([]);
    // Honour any pending genre stashed by the GenreExplorerWidget. Cleared
    // immediately so a future fresh mount of /browse doesn't pick up a stale
    // filter from a long-ago widget click.
    const [genre,       setGenre]       = useState(() => {
      const pending = window._gpPendingGenreFilter;
      if (pending) { window._gpPendingGenreFilter = null; return pending; }
      return initialGenre || "";
    });
    const [sort,        setSort]        = useState("newest");
    const searchTimer = useRef(null);

    function load(p, s, g, q, append) {
      setLoading(true);
      if (!append) setGames([]);
      const params = new URLSearchParams({ page: p, sort: s });
      if (g) params.set("genre", g);
      if (q) params.set("search", q);
      apiFetch("/games?" + params)
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

    // Listen for genre filter events from the GenreExplorerWidget. Fired when
    // the widget is clicked while /browse is already mounted — we update the
    // dropdown's selection and reload, no navigation required.
    useEffect(() => {
      function onGenre(ev) {
        const g = ev.detail?.genre || "";
        setGenre(g);
        setPage(1);
        load(1, sort, g, search);
      }
      window.addEventListener("gp:genre-filter", onGenre);
      return () => window.removeEventListener("gp:genre-filter", onGenre);
    }, [sort, search]);

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
          options:  [{ value: "", label: "All Genres" }, ...genres.map(g => ({ value: g.slug, label: g.name }))],
        }),
        e(GpDropdown, {
          value:    sort,
          onChange: v => { setSort(v); setPage(1); load(1, v, genre, search); },
          options:  [
            { value: "newest", label: "Newest" },
            { value: "az",     label: "A → Z" },
            { value: "za",     label: "Z → A" },
            { value: "oldest", label: "Oldest" },
          ],
        })
      ),
      e("div", { className: "gp-gl-count" }, total + " game" + (total === 1 ? "" : "s")),
      games.length === 0 && !loading
        ? e("div", { className: "gp-empty" }, "No games found.")
        : e("div", { className: "gp-gl-grid" },
            games.map(g => e("div", { key: g.id, className: "gp-gl-card",
              onClick: () => nav("/ext/" + SLUG + "/games/" + g.slug),
              style:   { cursor: "pointer" } },
              g.cover_image_url
                ? e("img", { src: g.cover_image_url, alt: g.name, className: "gp-gl-cover" })
                : e("div", { className: "gp-gl-cover gp-gl-cover-empty" },
                    e("i", { className: "fa-solid fa-gamepad" })),
              e("div", { className: "gp-gl-card-info" },
                e("div", { className: "gp-gl-card-name" }, g.name),
                g.release_year && e("div", { className: "gp-gl-card-year" }, g.release_year),
                g.developer && e("div", { className: "gp-gl-card-added" }, g.developer)
              )
            ))
          ),
      hasMore && e("div", { style: { textAlign: "center", padding: "20px 0" } },
        e("button", {
          className: "gp-btn",
          disabled:  loading,
          onClick:   () => { const p = page + 1; setPage(p); load(p, sort, genre, search, true); },
        }, loading ? "Loading\u2026" : "Load more")
      )
    );
  }

  // ---------------------------------------------------------------------------
  // GpDropdown — small custom select.
  // ---------------------------------------------------------------------------

  function GpDropdown({ value, onChange, options, style }) {
    const [open, setOpen] = useState(false);
    const ref = useRef();

    useEffect(() => {
      function handleClick(ev) {
        if (ref.current && !ref.current.contains(ev.target)) setOpen(false);
      }
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }, []);

    const current = options.find(o => o.value === value) || options[0];
    return e("div", { ref, className: "gp-dropdown", style },
      e("button", {
        className: "gp-dropdown-trigger",
        onClick:   () => setOpen(o => !o),
      },
        current?.label,
        e("i", { className: "fa-solid fa-chevron-down", style: { marginLeft: 8, fontSize: 10 } })
      ),
      open && e("div", { className: "gp-dropdown-menu" },
        options.map(o => e("button", {
          key:       o.value,
          className: "gp-dropdown-item" + (o.value === value ? " active" : ""),
          onClick:   () => { onChange(o.value); setOpen(false); },
        }, o.label))
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Sidebar widgets — MostDiscussed, MostGamelogd, GenreExplorer.
  // Scoped via manifest to /browse and /games/:slug only.
  // ---------------------------------------------------------------------------

  function GameRow({ game, countIcon, count }) {
    return e("div", {
      onClick: () => nav("/ext/" + SLUG + "/games/" + game.slug),
      style: {
        display: "flex", alignItems: "center", gap: 9,
        padding: "5px 0", borderBottom: "0.5px solid var(--b1)",
        cursor: "pointer",
      },
    },
      game.cover_image_url
        ? e("img", { src: game.cover_image_url, alt: game.name,
            style: { width: 26, height: 35, borderRadius: 4, objectFit: "cover", flexShrink: 0 } })
        : e("div", {
            style: { width: 26, height: 35, borderRadius: 4, flexShrink: 0,
              background: "rgba(255,255,255,0.06)", display: "flex",
              alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--t5)" },
          }, e("i", { className: "fa-solid fa-gamepad" })),
      e("div", { style: { flex: 1, minWidth: 0 } },
        e("div", { style: { fontSize: 12, fontWeight: 500, color: "var(--t1)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, game.name),
        e("div", { style: { fontSize: 11, color: "var(--t4)", marginTop: 1 } },
          [game.developer, game.release_year].filter(Boolean).join(" \u00b7 ")
        )
      ),
      count !== "" && e("div", {
        style: { fontSize: 11, fontWeight: 500, color: "var(--t4)",
          flexShrink: 0, display: "flex", alignItems: "center", gap: 3 },
      },
        e("i", { className: "fa-solid " + countIcon, style: { fontSize: 10 } }),
        count
      )
    );
  }

  function WidgetSpinner() {
    return e("div", { style: { textAlign: "center", padding: "16px 0", color: "var(--t5)" } },
      e("i", { className: "fa-solid fa-spinner fa-spin" })
    );
  }

  function WidgetEmpty({ text }) {
    return e("div", { style: { textAlign: "center", padding: "12px 0", color: "var(--t5)", fontSize: 12 } }, text);
  }

  function SortPills({ active, onChange }) {
    return e("div", { className: "gp-sort-pills" },
      ["Week", "Month", "All"].map(s => e("button", {
        key: s,
        className: "gp-sort-pill" + (active === s ? " active" : ""),
        onClick: () => onChange(s),
      }, s))
    );
  }

  function MostDiscussedWidget() {
    const [sort,    setSort]    = useState("Week");
    const [games,   setGames]   = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      setLoading(true);
      const period = sort === "Week" ? "week" : sort === "Month" ? "month" : "all";
      apiFetch("/widgets/most-discussed?period=" + period)
        .then(r => { setGames(r.data || []); setLoading(false); })
        .catch(() => setLoading(false));
    }, [sort]);

    return e("div", { className: "rw" },
      e("div", { className: "rw-label" }, "most discussed"),
      e(SortPills, { active: sort, onChange: setSort }),
      loading
        ? e(WidgetSpinner)
        : games.length === 0
          ? e(WidgetEmpty, { text: "No games this period." })
          : games.map(game => e(GameRow, {
              key:       game.id,
              game,
              countIcon: "fa-message",
              count:     game.thread_count,
            }))
    );
  }

  function MostGamelogdWidget() {
    const [sort,    setSort]    = useState("Week");
    const [games,   setGames]   = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      setLoading(true);
      const period = sort === "Week" ? "week" : sort === "Month" ? "month" : "all";
      apiFetch("/widgets/most-gamelogd?period=" + period)
        .then(r => { setGames(r.data || []); setLoading(false); })
        .catch(() => setLoading(false));
    }, [sort]);

    return e("div", { className: "rw" },
      e("div", { className: "rw-label" }, "most gamelog'd"),
      e(SortPills, { active: sort, onChange: setSort }),
      loading
        ? e(WidgetSpinner)
        : games.length === 0
          ? e(WidgetEmpty, { text: "No games this period." })
          : games.map(game => e(GameRow, {
              key:       game.id,
              game,
              countIcon: "fa-bookmark",
              count:     game.gamelog_count,
            }))
    );
  }

  function GenreExplorerWidget() {
    const [genres,  setGenres]  = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      apiFetch("/admin/genres")
        .then(r => {
          const withGames = (r.data || []).filter(g => (g.game_count || 0) > 0);
          setGenres(withGames.sort((a, b) => (b.game_count || 0) - (a.game_count || 0)));
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }, []);

    return e("div", { className: "rw" },
      e("div", { className: "rw-label" }, "genres"),
      loading
        ? e(WidgetSpinner)
        : genres.length === 0
          ? e(WidgetEmpty, { text: "No genres yet." })
          : e("div", { className: "gp-genre-cloud" },
              genres.slice(0, 12).map(g => e("button", {
                key:       g.id,
                className: "gp-genre-pill",
                onClick:   () => {
                  // Set the genre filter on the browse page. Two cases:
                  //   - Already on /browse: dispatch an event the page listens
                  //     for; it updates its dropdown + reloads. No navigation.
                  //   - On /games/:slug: stash on window, then navigate. The
                  //     browse page reads and clears the stash on mount.
                  //
                  // Query strings can't ride through nav() — Nexus's matchRoute
                  // doesn't strip the query before matching, so any URL with
                  // ?foo=bar fails to match and the navigate falls through to
                  // an empty ext-route with null _match (infinite loading).
                  // The stash-on-window pattern sidesteps that entirely.
                  window._gpPendingGenreFilter = g.slug;
                  window.dispatchEvent(new CustomEvent("gp:genre-filter", {
                    detail: { genre: g.slug }
                  }));
                  if (!window.location.pathname.endsWith("/ext/" + SLUG + "/browse")) {
                    nav("/ext/" + SLUG + "/browse");
                  }
                },
              }, g.name, e("span", { className: "gp-genre-pill-count" }, g.game_count)))
            )
    );
  }

  // ---------------------------------------------------------------------------
  // Admin panel — TabbedPanel wrapping custom tabs for Games / Genres / Stats
  // and SimpleSettingsPanel for Credentials / Digest / Post Sidebar.
  //
  // The admin panel's top-bar Save button is wired automatically. Each
  // SimpleSettingsPanel registers its save fn via the host's
  // _nexusAdminSaveFn global when it mounts (i.e. when its tab is active).
  // Custom tabs (Games / Genres / Stats) have no save fn, so the top-bar
  // Save button is correctly inert while those tabs are active. Switching
  // tabs unmounts the previous content and re-registers as appropriate.
  // ---------------------------------------------------------------------------

  function GamepediaAdminPanel() {
    return e(TabbedPanel, {
      tabs: [
        { key: "games",  label: "Games",  icon: "fa-gamepad",
          render: () => e(GamesAdminTab) },
        { key: "genres", label: "Genres", icon: "fa-tags",
          render: () => e(GenresAdminTab) },
        { key: "stats",  label: "Stats",  icon: "fa-chart-bar",
          render: () => e(StatsAdminTab) },
        { key: "digest", label: "Digest", icon: "fa-envelope-open-text",
          render: () => e(SimpleSettingsPanel, {
            slug: SLUG,
            fields: [
              { key: "digest_new_games_count",      label: "New Games count",      type: "number",
                hint: "Games to show in the New Games digest section." },
              { key: "digest_top_gamelogs_count",   label: "Most Gamelog'd count", type: "number",
                hint: "Games to show in the Most Gamelog'd digest section." },
              { key: "digest_most_discussed_count", label: "Most Discussed count", type: "number",
                hint: "Games to show in the Most Discussed digest section." },
            ],
          }) },
        { key: "post_sidebar", label: "Post Sidebar", icon: "fa-window-maximize",
          render: () => e(SimpleSettingsPanel, {
            slug: SLUG,
            fields: [
              { key: "max_linked_games",  label: "Max linked games per post", type: "number",
                hint: "How many games an author can link to a single post." },
              { key: "slideshow_seconds", label: "Slideshow timer (seconds)", type: "number",
                hint: "How long each linked game shows before rotating to the next." },
            ],
          }) },
        { key: "credentials", label: "Credentials", icon: "fa-key",
          render: () => e(SimpleSettingsPanel, {
            slug: SLUG,
            fields: [
              { key: "igdb_client_id",     label: "IGDB Client ID",     type: "string",
                hint: "From dev.twitch.tv — the Client ID for your Twitch application." },
              { key: "igdb_client_secret", label: "IGDB Client Secret", type: "string", secret: true,
                hint: "From dev.twitch.tv — the Client Secret. Stored encrypted." },
            ],
          }) },
      ],
    });
  }

  // ── Admin: Games tab ──────────────────────────────────────────────────────

  function GamesAdminTab() {
    const [games,       setGames]       = useState([]);
    const [loading,     setLoading]     = useState(true);
    const [totalGames,  setTotalGames]  = useState(0);
    const [hasMore,     setHasMore]     = useState(false);
    const [page,        setPage]        = useState(1);
    const [searchInput, setSearchInput] = useState("");
    const [search,      setSearch]      = useState("");
    const [genreFilter, setGenreFilter] = useState("");
    const [sort,        setSort]        = useState("newest");
    const [filterGenres, setFilterGenres] = useState([]);
    const [refreshing,   setRefreshing]   = useState({});
    const [deleting,     setDeleting]     = useState({});
    const [showAddModal, setShowAddModal] = useState(false);
    const [editAwardGame, setEditAwardGame] = useState(null);
    const [editGenreGame, setEditGenreGame] = useState(null);
    const [genres,        setGenres]        = useState([]);
    const searchTimer = useRef(null);

    function loadGames(p, append) {
      setLoading(true);
      const params = new URLSearchParams({ page: p, sort });
      if (search)      params.set("search", search);
      if (genreFilter) params.set("genre",  genreFilter);
      apiFetch("/admin/games?" + params)
        .then(d => {
          setGames(prev => append ? [...prev, ...(d.data || [])] : (d.data || []));
          setTotalGames(d.meta?.total || 0);
          setHasMore(d.meta?.has_more || false);
          if (d.filters?.genres) setFilterGenres(d.filters.genres);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }

    function loadGenres() {
      apiFetch("/admin/genres")
        .then(d => setGenres(d.data || []))
        .catch(() => {});
    }

    useEffect(() => { loadGames(1); loadGenres(); }, []);
    useEffect(() => { loadGames(1); }, [sort, search, genreFilter]);

    function refreshGame(game) {
      setRefreshing(p => ({ ...p, [game.id]: true }));
      apiFetch("/admin/games/" + game.id + "/refresh", { method: "POST", body: {} })
        .then(d => { if (d.data) setGames(p => p.map(g => g.id === d.data.id ? { ...g, ...d.data } : g)); })
        .finally(() => setRefreshing(p => ({ ...p, [game.id]: false })));
    }

    function deleteGame(game) {
      if (!confirm("Delete \"" + game.name + "\"? This removes all screenshots and the game's data.")) return;
      setDeleting(p => ({ ...p, [game.id]: true }));
      apiFetch("/admin/games/" + game.id, { method: "DELETE" })
        .then(d => { if (d.ok) setGames(p => p.filter(g => g.id !== game.id)); })
        .finally(() => setDeleting(p => ({ ...p, [game.id]: false })));
    }

    return e("div", null,
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
              searchTimer.current = setTimeout(() => setSearch(ev.target.value), 400);
            },
          }),
          filterGenres.length > 0 && e(GpDropdown, {
            value:    genreFilter,
            onChange: setGenreFilter,
            options:  [{ value: "", label: "All Genres" }, ...filterGenres.map(g => ({ value: g.slug, label: g.name }))],
          }),
          e(GpDropdown, {
            value:    sort,
            onChange: setSort,
            options:  [
              { value: "newest", label: "Newest" },
              { value: "az",     label: "A → Z" },
              { value: "za",     label: "Z → A" },
              { value: "oldest", label: "Oldest" },
            ],
          })
        ),
        e("button", { className: "gp-btn-primary", onClick: () => setShowAddModal(true) },
          e("i", { className: "fa-solid fa-plus", style: { marginRight: 6 } }), "Add Game"
        )
      ),
      e("div", { className: "gp-admin-count" }, totalGames + " game" + (totalGames === 1 ? "" : "s")),
      loading && games.length === 0
        ? e(WidgetSpinner)
        : games.length === 0
          ? e(WidgetEmpty, { text: "No games yet. Click Add Game to import some." })
          : e("div", { className: "gp-admin-grid" },
              games.map(g => e("div", { key: g.id, className: "gp-admin-card" },
                g.cover_image_url
                  ? e("img", { src: g.cover_image_url, alt: g.name, className: "gp-admin-card-cover" })
                  : e("div", { className: "gp-admin-card-nocover" }, e("i", { className: "fa-solid fa-gamepad" })),
                e("div", { className: "gp-admin-card-info" },
                  e("div", { className: "gp-admin-card-name" }, g.name),
                  g.release_year && e("div", { className: "gp-admin-card-year" }, String(g.release_year)),
                  g.genres && g.genres.length > 0 && e("div", { className: "gp-admin-card-genres" },
                    g.genres.map(genre => e("span", { key: genre.id, className: "gp-genre-tag" }, genre.name))
                  )
                ),
                e("div", { className: "gp-admin-card-actions" },
                  e("button", { className: "gp-admin-btn", title: "Edit genres",
                    onClick: () => setEditGenreGame(g) },
                    e("i", { className: "fa-solid fa-tags" })),
                  e("button", { className: "gp-admin-btn", title: "Awards",
                    onClick: () => setEditAwardGame(g) },
                    e("i", { className: "fa-solid fa-trophy" })),
                  e("button", { className: "gp-admin-btn", title: "Refresh from IGDB",
                    disabled: !!refreshing[g.id],
                    onClick:  () => refreshGame(g),
                  }, e("i", { className: refreshing[g.id] ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-sync" })),
                  e("button", { className: "gp-admin-btn gp-admin-btn-danger", title: "Delete",
                    disabled: !!deleting[g.id],
                    onClick:  () => deleteGame(g),
                  }, e("i", { className: deleting[g.id] ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-trash" }))
                )
              ))
            ),
      hasMore && e("div", { style: { textAlign: "center", padding: "16px 0" } },
        e("button", { className: "gp-btn", onClick: () => { const p = page + 1; setPage(p); loadGames(p, true); } },
          "Load more")
      ),
      showAddModal && e(AddGameModal, {
        onGameAdded: () => loadGames(1),
        onClose:     () => setShowAddModal(false),
      }),
      editGenreGame && e(EditGenresModal, {
        game:    editGenreGame,
        genres,
        onSaved: updated => {
          setGames(p => p.map(g => g.id === updated.id ? updated : g));
          setEditGenreGame(null);
        },
        onClose: () => setEditGenreGame(null),
      }),
      editAwardGame && e(AwardsModal, {
        game:    editAwardGame,
        onClose: () => setEditAwardGame(null),
      })
    );
  }

  // ── Admin: Genres tab ─────────────────────────────────────────────────────

  function GenresAdminTab() {
    const [genres,   setGenres]   = useState([]);
    const [loading,  setLoading]  = useState(true);
    const [newGenre, setNewGenre] = useState("");
    const [creating, setCreating] = useState(false);

    function load() {
      setLoading(true);
      apiFetch("/admin/genres")
        .then(d => { setGenres(d.data || []); setLoading(false); })
        .catch(() => setLoading(false));
    }

    useEffect(() => { load(); }, []);

    function createGenre() {
      if (!newGenre.trim() || creating) return;
      setCreating(true);
      apiFetch("/admin/genres", { method: "POST", body: { name: newGenre.trim() } })
        .then(d => { if (d.data) { setNewGenre(""); load(); } })
        .finally(() => setCreating(false));
    }

    function deleteGenre(genre) {
      if (!confirm("Delete \"" + genre.name + "\"? This unlinks it from all games.")) return;
      apiFetch("/admin/genres/" + genre.id, { method: "DELETE" })
        .then(d => { if (d.ok) load(); });
    }

    return e("div", null,
      e("div", { style: { display: "flex", gap: 8, marginBottom: 16 } },
        e("input", {
          className:   "gp-input",
          type:        "text",
          placeholder: "New genre name\u2026",
          value:       newGenre,
          style:       { flex: 1 },
          onChange:    ev => setNewGenre(ev.target.value),
          onKeyDown:   ev => { if (ev.key === "Enter") createGenre(); },
        }),
        e("button", { className: "gp-btn-primary", disabled: creating, onClick: createGenre },
          e("i", { className: "fa-solid fa-plus", style: { marginRight: 6 } }), "Add")
      ),
      loading
        ? e(WidgetSpinner)
        : genres.length === 0
          ? e(WidgetEmpty, { text: "No genres yet." })
          : e("div", { className: "gp-admin-genres" },
              genres.map(g => e("div", { key: g.id, className: "gp-admin-genre" },
                e("div", { className: "gp-admin-genre-name" }, g.name),
                e("div", { className: "gp-admin-genre-count" }, (g.game_count || 0) + " game" + (g.game_count === 1 ? "" : "s")),
                e("button", { className: "gp-btn-sm gp-btn-danger", onClick: () => deleteGenre(g) },
                  e("i", { className: "fa-solid fa-trash" }))
              ))
            )
    );
  }

  // ── Admin: Stats tab ──────────────────────────────────────────────────────

  function StatsAdminTab() {
    const [stats,   setStats]   = useState(null);
    const [loading, setLoading] = useState(true);

    function load() {
      setLoading(true);
      apiFetch("/admin/stats")
        .then(d => { setStats(d.data); setLoading(false); })
        .catch(() => setLoading(false));
    }

    useEffect(() => { load(); }, []);

    if (loading) return e(WidgetSpinner);
    if (!stats) return e(WidgetEmpty, { text: "Failed to load stats." });

    // Cards in the same shape and order as the original: total / screenshots
    // (with MB suffix) / gamelogs / no-genre (warn if > 0) / no-cover (warn).
    const cards = [
      { label: "Total Games",     value: stats.total_games },
      { label: "Screenshots",     value: stats.total_screenshots + " (~" + stats.estimated_disk_mb + " MB)" },
      { label: "Gamelog Entries", value: stats.total_gamelogs },
      { label: "No Genre",        value: stats.games_no_genre, warn: stats.games_no_genre > 0 },
      { label: "No Cover",        value: stats.games_no_cover, warn: stats.games_no_cover > 0 },
    ];

    return e("div", null,
      e("div", { className: "gp-stats-grid" },
        cards.map(s => e("div", {
          key:       s.label,
          className: "gp-stat-card" + (s.warn ? " warn" : ""),
        },
          e("div", { className: "gp-stat-value" }, String(s.value)),
          e("div", { className: "gp-stat-label" }, s.label)
        ))
      ),
      stats.top_gamelog_games && stats.top_gamelog_games.length > 0 && e("div", { className: "gp-stats-top" },
        e("h4", { className: "gp-stats-top-title" }, "Most Gamelog\u2019d"),
        e("ol", { className: "gp-stats-top-list" },
          stats.top_gamelog_games.map(g => e("li", { key: g.id },
            e("span", null, g.name),
            e("span", { className: "gp-stats-count" }, g.gamelog_count + " users")
          ))
        )
      ),
      e("button", { className: "gp-btn", style: { marginTop: 12 }, onClick: load },
        e("i", { className: "fa-solid fa-sync", style: { marginRight: 6 } }), "Refresh")
    );
  }

  // ---------------------------------------------------------------------------
  // AddGameModal — admin imports a game from IGDB.
  // Credentials are NOT passed from the client; the server reads them from
  // extension settings. If they're missing, the API returns 503.
  // ---------------------------------------------------------------------------

  function AddGameModal({ onGameAdded, onClose }) {
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
      apiFetch("/games/search?q=" + encodeURIComponent(q))
        .then(r => {
          setLoading(false);
          setResults(r.data || []);
          if (r.error) setError(r.error);
        })
        .catch(() => { setLoading(false); setError("Search failed."); });
    }

    function addGame(game) {
      setAdding(p => ({ ...p, [game.igdb_id]: true }));
      apiFetch("/admin/games/import", { method: "POST", body: { igdb_id: game.igdb_id } })
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
          e("i", { className: "fa-solid fa-spinner fa-spin" }), " Searching IGDB\u2026"),
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
                game.release_year && e("span", { className: "gp-import-year" }, " (" + game.release_year + ")"),
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
  // AwardsModal — admin manages a game's awards.
  // ---------------------------------------------------------------------------

  function AwardsModal({ game, onClose }) {
    const [awards,   setAwards]   = useState([]);
    const [loading,  setLoading]  = useState(true);
    const [newYear,  setNewYear]  = useState("");
    const [newTitle, setNewTitle] = useState("");
    const [adding,   setAdding]   = useState(false);
    const [editing,  setEditing]  = useState(null);
    const [editYear, setEditYear]   = useState("");
    const [editTitle, setEditTitle] = useState("");

    function loadAwards() {
      setLoading(true);
      apiFetch("/admin/games/" + game.id + "/awards")
        .then(d => { setAwards(d.data || []); setLoading(false); })
        .catch(() => setLoading(false));
    }

    useEffect(() => { loadAwards(); }, [game.id]);

    function addAward() {
      const y = parseInt(newYear);
      if (!y || !newTitle.trim() || adding) return;
      setAdding(true);
      apiFetch("/admin/games/" + game.id + "/awards", {
        method: "POST", body: { year: y, title: newTitle.trim() },
      })
        .then(d => { if (d.ok) { setNewYear(""); setNewTitle(""); loadAwards(); } })
        .finally(() => setAdding(false));
    }

    function saveEdit(id) {
      const y = parseInt(editYear);
      if (!y || !editTitle.trim()) return;
      apiFetch("/admin/awards/" + id, {
        method: "PATCH", body: { year: y, title: editTitle.trim() },
      })
        .then(d => { if (d.ok) { setEditing(null); loadAwards(); } });
    }

    function deleteAward(id) {
      if (!confirm("Delete award?")) return;
      apiFetch("/admin/awards/" + id, { method: "DELETE" })
        .then(d => { if (d.ok) loadAwards(); });
    }

    return e("div", {
      className: "gp-modal-overlay",
      onMouseDown: ev => { if (ev.target === ev.currentTarget) onClose(); },
    },
      e("div", { className: "gp-modal" },
        e("div", { className: "gp-modal-header" },
          e("span", { className: "gp-modal-title" }, "Awards: " + game.name),
          e("button", { className: "gp-modal-close", onClick: onClose }, "\u2715")
        ),
        e("div", { style: { padding: "12px 0 16px", display: "flex", gap: 8 } },
          e("input", {
            className: "gp-input", type: "number", placeholder: "Year",
            value: newYear, style: { width: 90 },
            onChange: ev => setNewYear(ev.target.value),
          }),
          e("input", {
            className: "gp-input", type: "text", placeholder: "Award title",
            value: newTitle, style: { flex: 1 },
            onChange: ev => setNewTitle(ev.target.value),
            onKeyDown: ev => { if (ev.key === "Enter") addAward(); },
          }),
          e("button", { className: "gp-btn-primary", disabled: adding, onClick: addAward }, "Add")
        ),
        loading
          ? e(WidgetSpinner)
          : awards.length === 0
            ? e(WidgetEmpty, { text: "No awards yet." })
            : e("div", null,
                awards.map(a => e("div", { key: a.id, className: "gp-admin-award-row" },
                  editing === a.id
                    ? e("div", { style: { display: "flex", flex: 1, gap: 8 } },
                        e("input", { className: "gp-input", type: "number", value: editYear, style: { width: 90 },
                          onChange: ev => setEditYear(ev.target.value) }),
                        e("input", { className: "gp-input", type: "text", value: editTitle, style: { flex: 1 },
                          onChange: ev => setEditTitle(ev.target.value) }),
                        e("button", { className: "gp-btn-sm", onClick: () => saveEdit(a.id) }, "Save"),
                        e("button", { className: "gp-btn-sm", onClick: () => setEditing(null) }, "Cancel")
                      )
                    : e(React.Fragment, null,
                        e("span", { className: "gp-admin-award-year" }, a.year),
                        e("span", { className: "gp-admin-award-title" }, a.title),
                        e("button", { className: "gp-btn-sm",
                          onClick: () => { setEditing(a.id); setEditYear(String(a.year)); setEditTitle(a.title); } },
                          e("i", { className: "fa-solid fa-pen" })),
                        e("button", { className: "gp-btn-sm gp-btn-danger",
                          onClick: () => deleteAward(a.id) },
                          e("i", { className: "fa-solid fa-trash" }))
                      )
                ))
              )
      )
    );
  }

  // ---------------------------------------------------------------------------
  // EditGenresModal — admin assigns genres to a game.
  // ---------------------------------------------------------------------------

  function EditGenresModal({ game, genres, onSaved, onClose }) {
    const [selected, setSelected] = useState(new Set((game.genres || []).map(g => g.id)));
    const [saving,   setSaving]   = useState(false);

    function toggle(id) {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else              next.add(id);
        return next;
      });
    }

    function save() {
      setSaving(true);
      apiFetch("/admin/games/" + game.id + "/genres", {
        method: "POST", body: { genre_ids: Array.from(selected) },
      })
        .then(d => {
          if (d.ok) {
            const updatedGenres = genres
              .filter(g => selected.has(g.id))
              .map(g => ({ id: g.id, name: g.name, slug: g.slug }));
            onSaved({ ...game, genres: updatedGenres });
          }
        })
        .finally(() => setSaving(false));
    }

    return e("div", {
      className: "gp-modal-overlay",
      onMouseDown: ev => { if (ev.target === ev.currentTarget) onClose(); },
    },
      e("div", { className: "gp-modal" },
        e("div", { className: "gp-modal-header" },
          e("span", { className: "gp-modal-title" }, "Genres: " + game.name),
          e("button", { className: "gp-modal-close", onClick: onClose }, "\u2715")
        ),
        e("div", { style: { padding: "12px 0", display: "flex", flexWrap: "wrap", gap: 6 } },
          genres.map(g => e("button", {
            key:       g.id,
            className: "gp-genre-toggle" + (selected.has(g.id) ? " active" : ""),
            onClick:   () => toggle(g.id),
          }, g.name))
        ),
        e("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 } },
          e("button", { className: "gp-btn", onClick: onClose }, "Cancel"),
          e("button", { className: "gp-btn-primary", disabled: saving, onClick: save }, saving ? "Saving\u2026" : "Save")
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
.gp-btn{background:rgba(255,255,255,.08);border:0.5px solid rgba(255,255,255,.12);border-radius:8px;color:var(--t2);cursor:pointer;font-size:13px;padding:7px 16px;font-family:inherit;transition:background .12s;}
.gp-btn:hover{background:rgba(255,255,255,.13);}
.gp-btn:disabled{opacity:.5;cursor:not-allowed;}
.gp-btn-active{background:rgba(139,92,246,.12);border-color:rgba(139,92,246,.4);color:var(--ac);}
.gp-btn-primary{background:var(--ac);border:0.5px solid var(--ac);border-radius:8px;color:#fff;cursor:pointer;font-size:13px;padding:7px 16px;font-family:inherit;transition:opacity .12s;}
.gp-btn-primary:hover{opacity:.9;}
.gp-btn-primary:disabled{opacity:.5;cursor:not-allowed;}
.gp-btn-sm{background:rgba(255,255,255,.08);border:0.5px solid rgba(255,255,255,.12);border-radius:6px;color:var(--t2);cursor:pointer;font-size:11px;padding:5px 9px;font-family:inherit;transition:background .12s;display:inline-flex;align-items:center;gap:5px;}
.gp-btn-sm:hover{background:rgba(255,255,255,.13);}
.gp-btn-sm:disabled{opacity:.5;cursor:not-allowed;}
.gp-btn-danger{color:var(--red);border-color:rgba(248,113,113,.3);}
.gp-btn-danger:hover{background:rgba(248,113,113,.1);}
.gp-genre-tag{display:inline-block;font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(139,92,246,.12);color:var(--ac);margin-right:4px;}

/* ── Modal ── */
.gp-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:9999;}
.gp-modal{background:var(--s2);border:0.5px solid var(--b1);border-radius:14px;padding:18px 20px;width:min(600px,92vw);max-height:80vh;display:flex;flex-direction:column;}
.gp-modal-header{display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;border-bottom:0.5px solid var(--b1);margin-bottom:8px;}
.gp-modal-title{font-size:14px;font-weight:500;color:var(--t1);}
.gp-modal-close{background:none;border:none;color:var(--t4);font-size:16px;cursor:pointer;line-height:1;padding:0 4px;}
.gp-modal-search{padding:9px 12px;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;color:var(--t1);font-size:13px;outline:none;font-family:inherit;margin-bottom:10px;width:100%;box-sizing:border-box;}
.gp-modal-search:focus{border-color:var(--ac-border);}
.gp-modal-results{overflow-y:auto;flex:1;min-height:200px;}
.gp-modal-loading{text-align:center;padding:24px 0;color:var(--t5);font-size:13px;}
.gp-modal-empty{text-align:center;padding:24px 0;color:var(--t4);font-size:13px;}
.gp-modal-error{background:rgba(248,113,113,.12);color:#fca5a5;border:0.5px solid rgba(248,113,113,.3);border-radius:8px;padding:8px 12px;font-size:12px;margin-bottom:10px;}
.gp-modal-selected{display:flex;flex-wrap:wrap;gap:6px;padding:6px 0 10px;border-bottom:0.5px solid var(--b1);margin-bottom:8px;}
.gp-modal-selected-pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:3px 4px 3px 10px;border-radius:14px;background:rgba(139,92,246,.18);color:var(--ac);}
.gp-modal-selected-x{cursor:pointer;font-size:10px;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,255,255,.06);}
.gp-modal-selected-x:hover{background:rgba(255,255,255,.13);}
.gp-modal-footer{display:flex;justify-content:flex-end;padding-top:10px;border-top:0.5px solid var(--b1);margin-top:8px;}

/* Result rows */
.gp-result-row{display:flex;align-items:center;gap:10px;padding:8px;width:100%;background:none;border:0.5px solid transparent;border-radius:8px;cursor:pointer;text-align:left;color:var(--t1);font-family:inherit;}
.gp-result-row:hover{background:rgba(255,255,255,.04);}
.gp-result-row.is-linked{border-color:rgba(139,92,246,.4);background:rgba(139,92,246,.06);}
.gp-result-row.is-disabled{opacity:.4;cursor:not-allowed;}
.gp-result-cover{width:32px;height:42px;object-fit:cover;border-radius:4px;flex-shrink:0;}
.gp-result-nocover{width:32px;height:42px;background:rgba(255,255,255,.06);border-radius:4px;display:flex;align-items:center;justify-content:center;color:var(--t5);flex-shrink:0;}
.gp-result-info{flex:1;min-width:0;}
.gp-result-name{font-size:13px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.gp-result-year{font-size:11px;color:var(--t4);}
.gp-result-linked{font-size:11px;color:var(--ac);}

/* Import rows */
.gp-import-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid rgba(255,255,255,.04);}
.gp-import-cover{width:36px;height:48px;object-fit:cover;border-radius:4px;flex-shrink:0;}
.gp-import-nocover{width:36px;height:48px;background:rgba(255,255,255,.06);border-radius:4px;display:flex;align-items:center;justify-content:center;color:var(--t5);flex-shrink:0;}
.gp-import-info{flex:1;min-width:0;font-size:13px;color:var(--t1);}
.gp-import-year{color:var(--t4);font-size:12px;}
.gp-import-action{flex-shrink:0;}
.gp-import-done{font-size:12px;color:#10b981;display:inline-flex;align-items:center;gap:4px;}

/* ── Right widgets ── */
.gp-sort-pills{display:flex;gap:4px;margin-bottom:6px;}
.gp-sort-pill{background:rgba(255,255,255,.04);border:0.5px solid transparent;border-radius:6px;color:var(--t4);font-size:10px;padding:3px 8px;cursor:pointer;font-family:inherit;text-transform:uppercase;letter-spacing:.04em;}
.gp-sort-pill.active{background:rgba(139,92,246,.12);color:var(--ac);border-color:rgba(139,92,246,.3);}
.gp-genre-cloud{display:flex;flex-wrap:wrap;gap:4px;}
.gp-genre-pill{display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:3px 8px;border-radius:10px;background:rgba(255,255,255,.05);border:0.5px solid rgba(255,255,255,.08);color:var(--t3);cursor:pointer;font-family:inherit;}
.gp-genre-pill:hover{background:rgba(139,92,246,.1);color:var(--ac);border-color:rgba(139,92,246,.3);}
.gp-genre-pill-count{font-size:10px;color:var(--t5);}

/* ── Post sidebar card (original gp-psb-* family — cover-bottom overlay style) ── */
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
.gp-psb-slideshow{margin:8px 0 6px;}
.gp-psb-progress-bar{height:2px;background:rgba(255,255,255,.1);border-radius:2px;margin-bottom:8px;overflow:hidden;}
.gp-psb-progress-fill{height:100%;background:var(--ac);border-radius:2px;transition:width .1s linear;}
.gp-psb-dots{display:flex;justify-content:center;gap:5px;}
.gp-psb-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.2);cursor:pointer;transition:background .15s;}
.gp-psb-dot.active{background:var(--ac);}

/* ── Now Playing widget ── */
.gp-now-playing{display:flex;align-items:center;gap:10px;padding:4px 0;}
.gp-now-playing-cover{width:36px;height:48px;object-fit:cover;border-radius:5px;flex-shrink:0;}
.gp-now-playing-nocover{width:36px;height:48px;background:rgba(255,255,255,.06);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--t4);}
.gp-now-playing-info{min-width:0;}
.gp-now-playing-label{font-size:10px;color:var(--t4);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;}
.gp-now-playing-name{font-size:13px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

/* ── Gamelog tab / browse ── */
.gp-gamelog-page{padding:16px 0;}
.gp-gl-stats{margin-bottom:16px;}
.gp-gl-stats-playing{display:flex;align-items:center;gap:8px;padding:8px 14px;background:rgba(139,92,246,.08);border:0.5px solid rgba(139,92,246,.2);border-radius:10px;margin-bottom:12px;}
.gp-gl-stats-playing-label{font-size:10px;color:var(--ac);font-weight:500;text-transform:uppercase;letter-spacing:.07em;}
.gp-gl-stats-playing-name{font-size:13px;color:var(--t1);font-weight:500;}
.gp-gl-stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}
@media(max-width:767.99px){.gp-gl-stat-grid{grid-template-columns:repeat(2,1fr);}}
.gp-gl-stat-card{background:rgba(255,255,255,.04);border-radius:10px;padding:12px 14px;}
.gp-gl-stat-icon{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:10px;}
.gp-gl-stat-n{font-size:16px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.gp-gl-stat-l{font-size:11px;color:var(--t4);margin-top:2px;}
.gp-gl-filters{display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap;}
@media(max-width:767.99px){
  .gp-gl-filters > .gp-input{flex:1 1 100%;}
  .gp-gl-filters > .gp-dropdown{flex:1;min-width:0;}
  .gp-gl-filters > .gp-dropdown > .gp-dropdown-trigger{width:100%;justify-content:space-between;}
}
.gp-gl-count{font-size:12px;color:var(--t4);margin-bottom:10px;}
.gp-gl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;}
.gp-gl-card{background:var(--s2);border:0.5px solid var(--b1);border-radius:10px;overflow:hidden;}
.gp-gl-cover{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;}
.gp-gl-cover-empty{display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.06);font-size:32px;color:var(--t5);}
.gp-gl-card-info{padding:8px 10px;}
.gp-gl-card-name{font-size:13px;font-weight:500;color:var(--t1);cursor:pointer;margin-bottom:2px;}
.gp-gl-card-name:hover{color:var(--ac);}
.gp-gl-card-year{font-size:11px;color:var(--t4);}
.gp-gl-card-added{font-size:11px;color:var(--t4);margin-top:2px;}
.gp-gl-card-playing{font-size:11px;color:var(--ac);margin-top:4px;}
.gp-gl-card-actions{display:flex;gap:4px;margin-top:8px;}

/* ── Dropdown ── */
.gp-dropdown{position:relative;display:inline-block;}
.gp-dropdown-trigger{background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;color:var(--t1);font-size:13px;padding:7px 12px;cursor:pointer;font-family:inherit;display:flex;align-items:center;}
.gp-dropdown-trigger:hover{background:rgba(255,255,255,.1);}
.gp-dropdown-menu{position:absolute;top:calc(100% + 4px);left:0;background:var(--s2);border:0.5px solid var(--b1);border-radius:8px;padding:4px;z-index:100;min-width:140px;box-shadow:0 4px 12px rgba(0,0,0,.3);}
.gp-dropdown-item{display:block;width:100%;text-align:left;background:none;border:none;color:var(--t2);font-size:13px;padding:7px 10px;border-radius:6px;cursor:pointer;font-family:inherit;}
.gp-dropdown-item:hover{background:rgba(255,255,255,.06);}
.gp-dropdown-item.active{background:rgba(139,92,246,.1);color:var(--ac);}

/* ── Stars ── */
.gp-stars{display:inline-flex;gap:2px;}
.gp-stars i{color:rgba(255,255,255,.18);}
.gp-stars i.filled{color:#fbbf24;}

/* ── Game detail ── */
.gp-detail{padding:0 0 32px;}
.gp-detail-hero{position:relative;border-radius:12px;overflow:hidden;margin-bottom:24px;}
.gp-detail-hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(2px) brightness(.5);}
.gp-detail-hero-overlay{position:absolute;inset:0;background:linear-gradient(180deg,rgba(13,13,20,.4) 0%,rgba(13,13,20,.95) 100%);}
.gp-detail-hero-content{position:relative;display:flex;gap:24px;padding:32px 28px;align-items:flex-start;}
.gp-detail-cover{width:160px;border-radius:8px;flex-shrink:0;box-shadow:0 8px 24px rgba(0,0,0,.4);}
.gp-detail-cover-empty{height:213px;background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;font-size:48px;color:var(--t5);}
@media(max-width:767.99px){
  .gp-detail-hero-content{flex-direction:column;align-items:center;gap:16px;padding:24px 18px;text-align:center;}
  .gp-detail-cover{width:140px;}
  .gp-detail-cover-empty{height:186px;width:140px;}
  .gp-detail-genres{justify-content:center;}
  .gp-detail-actions{justify-content:center;}
  .gp-detail-hero-awards{justify-content:center;}
  .gp-detail-hero-rating > div{justify-content:center;}
}
.gp-detail-genres{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;}
.gp-detail-title{font-size:26px;font-weight:600;color:var(--t1);margin:0 0 6px;}
.gp-detail-sub{font-size:13px;color:var(--t4);margin-bottom:14px;}
.gp-detail-summary{font-size:13px;color:var(--t3);line-height:1.6;margin:0 0 16px;}
.gp-detail-actions{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;}
.gp-detail-hero-rating{margin-bottom:4px;}
.gp-detail-hero-awards{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 14px;}
.gp-detail-hero-award{display:flex;align-items:center;gap:5px;background:rgba(251,191,36,.12);border:0.5px solid rgba(251,191,36,.3);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:500;color:#fbbf24;}
.gp-detail-hero-award-year{opacity:.6;margin-left:2px;}
.gp-detail-section{margin-bottom:28px;padding:0 4px;}
.gp-detail-section-title{font-size:11px;color:var(--t4);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;font-weight:500;}
.gp-detail-screen{width:100%;border-radius:6px;display:block;cursor:pointer;}
.gp-detail-awards{display:flex;flex-direction:column;gap:8px;}
.gp-award{padding:8px 12px;background:var(--s2);border:0.5px solid var(--b1);border-radius:8px;font-size:13px;color:var(--t2);}
.gp-award-year{color:var(--t4);}
.gp-detail-info-block{background:var(--s2);border:0.5px solid var(--b1);border-radius:10px;padding:12px 14px;}
.gp-detail-info-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:0.5px solid rgba(255,255,255,.05);}
.gp-detail-info-row:last-child{border-bottom:none;}
.gp-detail-info-key{font-size:12px;color:var(--t4);}
.gp-detail-info-val{font-size:12px;color:var(--t2);text-align:right;}
.gp-detail-threads{background:var(--s2);border:0.5px solid var(--b1);border-radius:10px;overflow:hidden;}
.gp-detail-thread-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:0.5px solid var(--b1);cursor:pointer;}
.gp-detail-thread-row:last-child{border-bottom:none;}
.gp-detail-thread-row:hover{background:rgba(255,255,255,.03);}
.gp-detail-thread-avatar{width:28px;height:28px;border-radius:var(--av-radius);object-fit:cover;flex-shrink:0;}
.gp-detail-thread-avatar-init{background:rgba(139,92,246,.2);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;color:var(--ac);}
.gp-detail-thread-body{flex:1;min-width:0;}
.gp-detail-thread-name{font-size:13px;color:var(--t2);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.gp-detail-thread-meta{font-size:11px;color:var(--t4);display:block;margin-top:2px;}
.gp-detail-screens{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;}

/* ── Admin panel ── */
.gp-admin-toolbar{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;}
.gp-admin-filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.gp-admin-count{font-size:12px;color:var(--t4);margin-bottom:10px;}
.gp-admin-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;}
.gp-admin-card{background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden;}
.gp-admin-card-cover{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;}
.gp-admin-card-nocover{width:100%;aspect-ratio:3/4;display:flex;align-items:center;justify-content:center;font-size:28px;color:var(--t5);background:rgba(255,255,255,.04);}
.gp-admin-card-info{padding:8px 8px 4px;}
.gp-admin-card-name{font-size:12px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.gp-admin-card-year{font-size:11px;color:var(--t4);margin-top:1px;}
.gp-admin-card-genres{display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;}
.gp-admin-card-actions{display:flex;gap:4px;padding:4px 6px 6px;}
.gp-admin-btn{background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:6px;color:var(--t3);cursor:pointer;flex:1;font-size:11px;padding:5px;font-family:inherit;transition:background .12s,color .12s;}
.gp-admin-btn:hover{background:rgba(255,255,255,.1);color:var(--t1);}
.gp-admin-btn:disabled{opacity:.4;cursor:default;}
.gp-admin-btn-danger{color:#fca5a5;border-color:rgba(248,113,113,.3);}
.gp-admin-btn-danger:hover{background:rgba(248,113,113,.1);color:#fca5a5;}
.gp-admin-genres{display:flex;flex-direction:column;gap:6px;}
.gp-admin-genre{display:flex;align-items:center;justify-content:space-between;background:var(--s2);border:0.5px solid var(--b1);border-radius:8px;padding:8px 12px;}
.gp-admin-genre-name{font-size:13px;color:var(--t1);}
.gp-admin-genre-count{font-size:11px;color:var(--t4);}
.gp-admin-award-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid rgba(255,255,255,.04);}
.gp-admin-award-year{font-size:11px;color:var(--t4);width:50px;}
.gp-admin-award-title{flex:1;font-size:13px;color:var(--t1);}
.gp-genre-toggle{background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:14px;color:var(--t2);font-size:11px;padding:4px 10px;cursor:pointer;font-family:inherit;}
.gp-genre-toggle.active{background:rgba(139,92,246,.18);border-color:rgba(139,92,246,.4);color:var(--ac);}

/* ── Stats ── */
.gp-stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:20px;}
.gp-stat-card{background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:10px;padding:14px;}
.gp-stat-card.warn{border-color:rgba(251,191,36,.3);background:rgba(251,191,36,.05);}
.gp-stat-value{font-size:20px;font-weight:600;color:var(--t1);}
.gp-stat-label{font-size:11px;color:var(--t4);margin-top:2px;}
.gp-stats-top{margin-bottom:16px;}
.gp-stats-top-title{font-size:13px;color:var(--t2);margin-bottom:8px;font-weight:500;}
.gp-stats-top-list{padding-left:18px;}
.gp-stats-top-list li{display:flex;justify-content:space-between;font-size:13px;color:var(--t2);padding:3px 0;}
.gp-stats-count{color:var(--t4);font-size:12px;}
`;
  document.head.appendChild(style);

  // ---------------------------------------------------------------------------
  // Registrations — every register* call maps 1:1 to a manifest declaration.
  // ---------------------------------------------------------------------------

  // Routes (manifest.routes)
  NE.registerRoute(SLUG, "/games/:slug", GameDetailPage, { title: "Game" });
  NE.registerRoute(SLUG, "/browse",      GameBrowsePage, { title: "Browse Games" });

  // Explore item (manifest.explore)
  NE.registerExploreItem({
    slug:  SLUG,
    path:  "/browse",
    label: "Gamepedia",
    icon:  "fa-gamepad",
  });

  // Right widgets (manifest.right_widgets)
  NE.registerRightWidget({
    slug:      SLUG,
    id:        "gamepedia-post-card",
    label:     "Linked Games",
    component: PostSidebarGameCard,
    scope:     { corePages: ["post"] },
    priority:  50,
  });
  NE.registerRightWidget({
    slug:      SLUG,
    id:        "gamepedia-most-discussed",
    label:     "Most Discussed Games",
    component: MostDiscussedWidget,
    scope:     { path: ["/browse", "/games/:slug"] },
    priority:  50,
  });
  NE.registerRightWidget({
    slug:      SLUG,
    id:        "gamepedia-most-gamelogd",
    label:     "Most Gamelog'd Games",
    component: MostGamelogdWidget,
    scope:     { path: ["/browse", "/games/:slug"] },
    priority:  51,
  });
  NE.registerRightWidget({
    slug:      SLUG,
    id:        "gamepedia-genre-explorer",
    label:     "Genre Explorer",
    component: GenreExplorerWidget,
    scope:     { path: ["/browse", "/games/:slug"] },
    priority:  52,
  });
  NE.registerRightWidget({
    slug:      SLUG,
    id:        "gamepedia-now-playing",
    label:     "Now Playing",
    component: NowPlayingWidget,
    scope:     { path: ["/browse", "/games/:slug"] },
    priority:  53,
  });

  // Toolbar button (manifest.toolbar_buttons)
  NE.registerToolbarButton({
    slug:     SLUG,
    id:       "gamepedia-link-game",
    icon:     "fa-solid fa-gamepad",
    tip:      "Link a game",
    scope:    "posts",
    priority: 50,
    onClick({ attach }) {
      openGamePickerModal({
        max: getMaxLinkedGames(),
        onConfirm(games) {
          games.forEach(g => attach({ kind: "game_link", data: { game_id: g.id } }));
        },
      });
    },
  });

  // Profile tab (manifest.profile_tabs)
  NE.registerProfileTab({
    slug:      SLUG,
    id:        "gamelog",
    component: GamelogTab,
  });

  // Admin panel (manifest.admin_panel)
  NE.registerAdminPanel(SLUG, {
    label:     "Gamepedia",
    icon:      "fa-gamepad",
    component: GamepediaAdminPanel,
  });

  // User action — "View Gamelog" on user popover.
  NE.registerUserAction({
    id:    "gamepedia-view-gamelog",
    label: "View Gamelog",
    icon:  "fa-gamepad",
    onClick({ user, closeCard }) {
      closeCard && closeCard();
      nav("/profile/" + user.username + "/gamelog");
    },
    priority: 60,
  });

  // ---------------------------------------------------------------------------
  // Config bootstrap — fetch UI-affecting settings once and cache on window.
  //
  // `getMaxLinkedGames()` and `getSlideshowSeconds()` read these globals with
  // fallback to manifest defaults. The fetch happens after registrations so
  // routes are resolvable even if /config 404s in dev. Failure is non-fatal:
  // the helpers fall back to the schema defaults.
  // ---------------------------------------------------------------------------

  apiFetch("/config")
    .then(r => {
      const cfg = r?.data;
      if (cfg) {
        if (typeof cfg.max_linked_games === "number")  window._gpMaxLinkedGames   = cfg.max_linked_games;
        if (typeof cfg.slideshow_seconds === "number") window._gpSlideshowSeconds = cfg.slideshow_seconds;
      }
    })
    .catch(() => { /* fall back to defaults inside the helpers */ });
})();
