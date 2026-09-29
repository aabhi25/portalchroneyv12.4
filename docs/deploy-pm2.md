# Running AI Chroney on EC2 with pm2

The server is one Node process (`dist/index.js`). pm2 keeps it running:
it restarts it after a crash, restarts it if memory grows too large, starts it
again after the machine reboots, and keeps the logs.

Replace the placeholders before running anything:

| Placeholder | Meaning |
|---|---|
| `<APP_DIR>` | Where the repo is checked out on the box (the folder that has `package.json` and `ecosystem.config.cjs`) |
| `<DEPLOY_USER>` | The Linux user the app runs as (for example `ubuntu` or `ec2-user`) |
| `<ENV_FILE>` | Optional: a file with the production environment variables (`KEY=value` lines) |

## 1. One-time setup

```bash
# pm2 itself (global)
sudo npm install -g pm2

# Rotate logs so they don't fill the disk (keeps 14 x 50 MB files, compressed)
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

### Environment variables

The app reads its configuration (`DATABASE_URL`, `ENCRYPTION_KEY`, `COOKIE_SECRET`,
`SESSION_SECRET`, `PORT`, ...) from the environment. Use one of these two options:

- **Option A: env file (recommended).** Put the variables in `<ENV_FILE>` (keep it outside the
  repo and `chmod 600` it). Every `pm2 start` / `pm2 reload` must then run with
  `CHRONEY_ENV_FILE=<ENV_FILE>` set, as in the commands below. The app loads the file through Node's `--env-file`.
- **Option B: shell environment.** Export the variables in the shell before running `pm2 start`.
  pm2 remembers them. After changing a variable, run `pm2 reload chroney --update-env`.

Optional tuning variables (the defaults are fine):

| Variable | Default | What it does |
|---|---|---|
| `DB_POOL_MAX` | 20 | Maximum number of Postgres connections |
| `DB_CONNECT_TIMEOUT_MS` | 10000 | How long to wait for a DB connection before giving up |
| `DB_IDLE_TIMEOUT_MS` | 30000 | How long an idle DB connection is kept open |
| `DB_STATEMENT_TIMEOUT_MS` | 120000 | Server-side limit for a single SQL statement (0 turns it off) |
| `SHUTDOWN_DRAIN_MS` | 25000 | How long in-flight requests get to finish on stop or restart. If you raise it, raise `kill_timeout` in `ecosystem.config.cjs` too (to at least this value plus 10 s) |
| `PM2_MAX_MEMORY` | 1500M | Memory level at which pm2 restarts the app. Set it to about 70% of the instance's RAM |

## 2. First start

```bash
cd <APP_DIR>
# Stop the old nohup process first (find it with: pgrep -af "dist/index.js"), then:
npm ci
npm run build
CHRONEY_ENV_FILE=<ENV_FILE> pm2 start ecosystem.config.cjs --env production
# (Option B: leave out the CHRONEY_ENV_FILE=... prefix)

pm2 status                        # "chroney" should be "online"
curl -s localhost:<PORT>/health/ready   # {"status":"ok",... "database":{"ok":true}...}
```

## 3. Start automatically after a reboot (systemd)

```bash
pm2 startup systemd -u <DEPLOY_USER> --hp /home/<DEPLOY_USER>
# ^ prints a "sudo env PATH=... pm2 startup ..." command. Copy it and run it exactly as printed.
pm2 save                          # saves the current process list so it comes back after a reboot
```

Run `pm2 save` again whenever you change what pm2 runs, for example after a first start with new options.

## 4. Deploy a new version

```bash
cd <APP_DIR>
git pull
npm ci
npm run build
CHRONEY_ENV_FILE=<ENV_FILE> pm2 reload chroney --update-env
curl -s localhost:<PORT>/health/ready
```

`pm2 reload` sends SIGINT. The app then stops accepting new connections and stops its
background jobs. It gives in-flight requests up to 25 s to finish, closes voice WebSockets,
closes the DB pool and exits, and pm2 starts the new build. There is only one instance
(fork mode), so there is a short gap (a few seconds) while the new process boots. Don't switch to
cluster mode: the schedulers (campaigns, backups, CRM retries, TopScholar pollers) must run only once.

If you edited `ecosystem.config.cjs` itself, apply it with:

```bash
pm2 delete chroney && CHRONEY_ENV_FILE=<ENV_FILE> pm2 start ecosystem.config.cjs --env production && pm2 save
```

## 5. Logs and status

```bash
pm2 logs chroney                  # follow the live output (stdout + stderr)
pm2 logs chroney --lines 500      # show the last 500 lines
pm2 logs chroney --err            # errors only
pm2 monit                         # CPU / memory dashboard
pm2 describe chroney              # restarts, uptime, log file paths
ls ~/.pm2/logs/                   # chroney-out.log, chroney-error.log (rotated by pm2-logrotate)
```

To find crashes and restarts, search the logs for `[Process] Uncaught exception`,
`[Shutdown]` and `[Boot] AI Chroney server starting`. `pm2 describe chroney` shows the restart count.

## 6. Health checks

- `GET /health` checks liveness only: it always returns 200 while the process is up. Point load balancer liveness checks here.
- `GET /health/ready` checks readiness: it runs the database check (`SELECT 1`, 2 s budget) and the PDF renderer
  self-test. It returns 503 when the DB is unreachable or while the app is shutting down. Use it for deploy gating.

## 7. Stop or restart manually

```bash
pm2 restart chroney               # graceful: SIGINT first, then SIGKILL after 35 s if it still hasn't exited
pm2 stop chroney
pm2 start chroney
```
