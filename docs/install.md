# Install

Files360 is one Node.js process. It needs somewhere to keep its data directory and an S3-compatible bucket to write files to. It never serves the files itself: browsers fetch them from the bucket or your CDN.

## Docker (recommended)

```bash
curl -O https://raw.githubusercontent.com/dot360io/Files360/main/docker-compose.yml
docker compose up -d
docker compose logs files360 | grep setup
```

The last command prints a one-time link such as `http://localhost:4360/setup?token=…`. Open it and the setup wizard asks for four things:

1. **Database.** SQLite is the default and needs nothing installed. Postgres and MySQL work too, with a **Test connection** button that tells you which step failed.
2. **Administrator.** The email and password you sign in with.
3. **Storage.** Pick a provider and paste a bucket name and key pair. Saving uploads a test file, reads it back over the public URL and deletes it. You can skip this and do it later.
4. **First app.** A name and a folder. API keys are created afterwards, from the app's Keys tab.

The token is valid until the next restart, and the wizard closes for good when it finishes.

Everything Files360 needs to remember lives in the `/data` volume: `config.json`, `secrets.json` and, with SQLite, the database. **Back up that volume.** Losing `secrets.json` makes the stored bucket credentials unreadable.

The image is published for `linux/amd64` and `linux/arm64` as `ghcr.io/dot360io/files360`.

### With Postgres or MySQL

```bash
curl -O https://raw.githubusercontent.com/dot360io/Files360/main/docker-compose.postgres.yml
POSTGRES_PASSWORD=$(openssl rand -hex 24) docker compose -f docker-compose.postgres.yml up -d
```

`docker-compose.mysql.yml` works the same way with `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD`. Put the passwords in a `.env` file next to the compose file so they survive a restart. When `DATABASE_URL` is set, the wizard skips its database step.

### Without the wizard

For unattended deployments, give the administrator in the environment and the wizard never appears:

```yaml
environment:
  ADMIN_EMAIL: you@example.com
  ADMIN_PASSWORD: a-long-password   # hashed at start, never stored
```

`ADMIN_PASSWORD_HASH` (a bcrypt hash from `npm run hash-password`) works instead of a plain password. Either is only read when the database has no administrator yet.

## From source

Node.js 20.9 or later.

```bash
git clone https://github.com/dot360io/Files360.git
cd Files360
npm ci --omit=dev
npm start
```

The setup link is printed to the console. In production run it under a process manager; `ecosystem.config.js` is ready for PM2:

```bash
pm2 start ecosystem.config.js && pm2 save
```

## Behind a reverse proxy

Files360 listens on `127.0.0.1:4360` outside Docker. Put Nginx, Caddy or Traefik in front for TLS, and keep the proxy's body size limit above `MAX_UPLOAD_MB`:

```nginx
server {
  server_name files.example.com;
  client_max_body_size 30m;
  location / {
    proxy_pass http://127.0.0.1:4360;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Set `PUBLIC_URL=https://files.example.com` so the generated integration guides show the right address.

## Upgrading

Pull the new image (or `git pull && npm ci --omit=dev`) and restart. Database migrations run at every start.
