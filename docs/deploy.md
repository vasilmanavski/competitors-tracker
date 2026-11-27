# How I'd deploy it
I skipped the cloud bonus on purpose: the whole system starts with one command, so you can run it as is. This is how I'd put it online.

## A demo: one VM, the same compose file
- **One small Linux VM** (2 GB RAM) with Docker, then `git clone` and `docker compose up -d --build`. No code changes are needed: nginx in the web container already serves the UI and proxies `/api` to the API, so the app is reached on **one port** (8080).
- **A firewall that allows only SSH and the web port.** The compose file also publishes Postgres (5433), the API (3000) and the two mock services. That's handy on a laptop, but on a public VM they must stay closed.
- **HTTPS without buying a domain:** put Caddy in front, with a free `<ip>.sslip.io` hostname. Caddy gets the certificate by itself.
- **A password:** there's no login (the brief assumes one internal user), so a public demo would get nginx basic auth.
- Migrations run on startup, and `/health` reports whether the database is reachable, so a restart or redeploy is just `git pull && docker compose up -d --build`.

## Production: split it by job
- **Managed Postgres** (RDS, Cloud SQL, Neon) instead of the container: backups, point-in-time restore and failover come with it.
- **One instance is enough.** The bottleneck is the source's rate limit, not our process (see section 4 of the README's production numbers), so more replicas wouldn't poll faster. A platform that restarts the container when `/health` fails covers most of the availability need.
- **If downtime during a crash or redeploy matters:** split it into an API service with `SCHEDULER_ENABLED=false` (two copies behind a load balancer that checks `/health`) and **one worker** with the scheduler on (polling, summaries, retention). Polling stays in that single worker, because the rate limiter lives in one process.
- **The web bundle as static files on a CDN** (S3 + CloudFront or similar), with `/api` routed to the API.
- **Secrets from the platform** (the LLM key, the database URL) instead of the compose file. `SOURCE_BASE_URL` and `LLM_BASE_URL` point at the real source and LLM.
- **Logs and alerts:** the JSON logs go to the platform's log service, with alerts on "summaries paused" (the LLM circuit breaker), repeated `fetch_failed` polls, and the daily cap running out early.
- **CI:** typecheck and tests on each PR against a Postgres service container, then build and deploy the image on merge.
