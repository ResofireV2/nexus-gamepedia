# Gamepedia for Nexus

A game database extension for Nexus powered by IGDB.

## Requirements

- A free [Twitch Developer](https://dev.twitch.tv) account for IGDB API access
- Nexus already running on the same VPS
- A domain (or subdomain) pointing to your VPS, e.g. `gamepedia.billyrayfoss.com`

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

### 1. Update `manifest.json` with your real domain

Edit `manifest.json` and replace `gamepedia.billyrayfoss.com` with your actual domain:

```json
"webhook_url":  "https://gamepedia.billyrayfoss.com/webhook",
"js_bundle_url": "https://gamepedia.billyrayfoss.com/assets/gamepedia.js"
```

### 2. Expose Gamepedia publicly via Caddy (or your reverse proxy)

Add to your Caddyfile on the VPS:

```
gamepedia.billyrayfoss.com {
    reverse_proxy localhost:4001
}
```

Then reload Caddy:

```bash
caddy reload --config /etc/caddy/Caddyfile
```

Verify the service is reachable from the public internet:

```bash
curl https://gamepedia.billyrayfoss.com/api/health
# Expected: {"status":"ok","service":"gamepedia","version":"0.1.0"}
```

### 3. Push to GitHub

Commit and push so Nexus can fetch `manifest.json` from the repo URL:

```bash
git add manifest.json
git commit -m "stage 3: wire manifest webhook_url and js_bundle_url"
git push
```

### 4. Install in Nexus

In Nexus admin → Extensions → **Install from URL**, paste:

```
https://github.com/ResofireV2/nexus-gamepedia
```

Nexus fetches `manifest.json` from the repo, installs the extension, and
shows it in the Extensions list.

### 5. Configure IGDB credentials

Admin → Extensions → **Gamepedia** → Settings tab → enter Client ID and Secret → Save.

### 6. Test the webhook

Create a post on your forum. The Gamepedia service should log:

```
[Gamepedia] post_created — post_id=<id>
```

Check with:

```bash
docker compose -f docker-compose.prod.yml logs gamepedia --tail 20
```

Or test manually with curl:

```bash
curl -X POST https://gamepedia.billyrayfoss.com/webhook \
  -H "Content-Type: application/json" \
  -d '{"event":"post_created","payload":{"post_id":1},"settings":{},"extension":"gamepedia","timestamp":0}'
# Expected: {"ok":true}
```

### Optional: Webhook signature verification

In Nexus admin → Extensions → Gamepedia → Security tab, set a **Webhook Secret**.
Nexus will sign every webhook delivery with `X-Nexus-Signature: sha256=<hex>`.
Gamepedia verifies the signature and rejects requests that don't match.

---

## IGDB Credentials

1. Visit [dev.twitch.tv](https://dev.twitch.tv) and log in with your Twitch account
2. Go to **Console → Applications → Register Your Application**
3. Set the OAuth Redirect URL to `http://localhost`
4. Set Client Type to **Confidential**
5. Copy the **Client ID** and generate a **Client Secret**
