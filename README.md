# Gamepedia for Nexus

A game database extension for Nexus powered by IGDB.

## Requirements

- A free [Twitch Developer](https://dev.twitch.tv) account for IGDB API access
- Nexus already running on the same VPS

## Stage 1 — Deploy & Test

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

Get your Client ID and Secret from https://dev.twitch.tv

```bash
curl "http://localhost:4001/api/games/search?q=elden+ring&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET"
```

Expected: a JSON array of games with names, cover images, release years, developer, publisher.

If you see games — Stage 1 is complete.

## IGDB Credentials

1. Visit [dev.twitch.tv](https://dev.twitch.tv) and log in with your Twitch account
2. Go to **Console → Applications → Register Your Application**
3. Set the OAuth Redirect URL to `http://localhost`
4. Set Client Type to **Confidential**
5. Copy the **Client ID** and generate a **Client Secret**
