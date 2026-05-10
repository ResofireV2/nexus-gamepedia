# Gamepedia for Nexus

A game database extension for Nexus powered by IGDB.

## Deploy

```bash
cd /opt/gamepedia && git pull && docker compose -f docker-compose.prod.yml up -d --build
```

## Caddy configuration

The Gamepedia service runs on port 4001. Open `/etc/caddy/Caddyfile` on your
VPS and replace the existing `handle /gamepedia/*` block with the following,
inside the main `billyrayfoss.com { }` block:

```
# Gamepedia — only forward actual API/webhook/asset requests to the service.
# SPA routes like /gamepedia/admin and /gamepedia/users/:username fall
# through to Nexus, which handles them client-side via registerRoute.
@gamepedia_service {
    path /gamepedia/api/* /gamepedia/webhook /gamepedia/digest/* /gamepedia/assets/*
}
handle @gamepedia_service {
    uri strip_prefix /gamepedia
    reverse_proxy localhost:4001
}
```

Then reload Caddy:

```bash
caddy reload --config /etc/caddy/Caddyfile
```

## IGDB credentials

1. Visit [dev.twitch.tv](https://dev.twitch.tv) and log in with your Twitch account
2. Go to Console → Applications → Register Your Application
3. Set OAuth Redirect URL to `http://localhost`, Client Type to Confidential
4. Copy the Client ID and generate a Client Secret
5. In Nexus admin → Extensions → Gamepedia → IGDB Credentials → save

## Install

In Nexus admin → Extensions → Install from URL:

```
https://github.com/ResofireV2/nexus-gamepedia
```
