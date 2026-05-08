# Gamepedia for Nexus

A game database extension for Nexus powered by IGDB.

## Requirements

- A free [Twitch Developer](https://dev.twitch.tv) account for IGDB API access
- Nexus already running on the same VPS

---

## Stage 1 — Deploy & Test (IGDB connection)

### 1. Create a `.env` file alongside `docker-compose.prod.yml`

```
DB_PASSWORD=<your_nexus_db_password_from_/opt/nexus/.env>
SECRET_KEY_BASE=<run: openssl rand -base64 48>
```

### 2. Deploy

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### 3. Verify it's running

```bash
curl http://localhost:4001/api/health
# Expected: {"status":"ok","service":"gamepedia","version":"0.1.0"}
```

### 4. Test IGDB search

```bash
curl "http://localhost:4001/api/games/search?q=elden+ring&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET"
```

---

## Stage 2 — Game import and library

### Import a game

```bash
curl -X POST http://localhost:4001/api/admin/games/import \
  -H "Content-Type: application/json" \
  -d '{"igdb_id": 119133, "client_id": "YOUR_ID", "client_secret": "YOUR_SECRET"}'
```

### View the public library

```bash
curl http://localhost:4001/api/games
curl http://localhost:4001/api/games/elden-ring
```

---

## Stage 3 — Nexus manifest + admin settings panel

### 1. Add Gamepedia to your Caddyfile

The repo includes a `Caddyfile` snippet that proxies `/gamepedia/*` on your
existing domain through to the Gamepedia service. No new subdomain or DNS
changes needed.

Open `/etc/caddy/Caddyfile` on your VPS and paste the contents of this repo's
`Caddyfile` **inside** the `billyrayfoss.com { }` block, before the closing brace.

Then reload Caddy:

```bash
caddy reload --config /etc/caddy/Caddyfile
```

Verify Gamepedia is publicly reachable through Nexus's domain:

```bash
curl https://billyrayfoss.com/gamepedia/api/health
# Expected: {"status":"ok","service":"gamepedia","version":"0.1.0"}
```

### 2. Install the extension in Nexus

In Nexus admin → Extensions → **Install from URL**, paste:

```
https://github.com/ResofireV2/nexus-gamepedia
```

Nexus fetches `manifest.json` from the repo and installs the extension.

### 3. Configure IGDB credentials

Admin → Extensions → **Gamepedia** → Settings → enter your Client ID and Secret → Save.

### 4. Test the webhook

Create a post on your forum. Check the Gamepedia logs:

```bash
cd /opt/gamepedia && docker compose -f docker-compose.prod.yml logs gamepedia --tail 20
```

You should see:
```
[Gamepedia] post_created — post_id=<id>
```

Or test manually:

```bash
curl -X POST https://billyrayfoss.com/gamepedia/webhook \
  -H "Content-Type: application/json" \
  -d '{"event":"post_created","payload":{"post_id":1},"settings":{},"extension":"gamepedia","timestamp":0}'
# Expected: {"ok":true}
```

### Optional: Webhook signature verification

In Nexus admin → Extensions → Gamepedia → Security tab, set a **Webhook Secret**.
Nexus will sign every delivery with `X-Nexus-Signature: sha256=<hex>` and
Gamepedia will reject requests that don't match.

---

## Pull and rebuild after updates

```bash
cd /opt/gamepedia && git pull && docker compose -f docker-compose.prod.yml up -d --build
```

---

## IGDB Credentials

1. Visit [dev.twitch.tv](https://dev.twitch.tv) and log in with your Twitch account
2. Go to **Console → Applications → Register Your Application**
3. Set the OAuth Redirect URL to `http://localhost`
4. Set Client Type to **Confidential**
5. Copy the **Client ID** and generate a **Client Secret**
