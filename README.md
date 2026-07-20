![Gamepedia — your gaming encyclopedia](priv/static/banner.webp)

# Gamepedia for Nexus

A game database extension for Nexus powered by IGDB. Browse games, link forum threads to games, track your gamelog, rate games, and award accolades — all running inside the Nexus VM with no separate service or container required.

## Install

In Nexus admin → Extensions → **Install from URL**:

```
https://github.com/ResofireV2/nexus-gamepedia
```

Nexus will download the extension, compile it into the running VM, and run all database migrations automatically.

## Update

Push a new release to GitHub, then in Nexus admin → Extensions → Gamepedia → **Update**.

Nexus will fetch the new release tarball, purge the old compiled modules, recompile, and run any new migrations — no restart required.

## IGDB credentials

1. Visit [dev.twitch.tv](https://dev.twitch.tv) and log in with your Twitch account
2. Go to Console → Applications → Register Your Application
3. Set OAuth Redirect URL to `http://localhost`, Client Type to Confidential
4. Copy the Client ID and generate a Client Secret
5. In Nexus admin → Extensions → Gamepedia → **Credentials** tab → enter your Client ID and Client Secret → Save

## Features

- **Game library** — import games from IGDB with cover art, screenshots, trailers, genres, and metadata
- **Game detail pages** — full game info, community ratings (1–5), awards, linked forum threads, screenshots
- **Gamelog** — members can track games they've played, mark what they're currently playing, and view stats. Surfaced as a tab on every user's profile, and as a "View Gamelog" action on the user card popover
- **Ratings** — 1–5 per-user star ratings with community average and score distribution chart
- **Awards** — admin-curated accolades (e.g. "Game of the Year 2024") displayed on game pages
- **Post linking** — link any forum thread to a game via the composer toolbar
- **Admin panel** — import/refresh/delete games, manage genres, manage awards, view stats
- **Digest integration** — "New Games", "Most Gamelog'd", and "Most Discussed" sections in the Nexus digest email
- **Sidebar integration** — Gamepedia browse link in the left sidebar, Now Playing widget in the right panel, linked-games card on post pages
