# Deploy Antimat Lab

Public site: <https://grady-ta-antimats-lab.pages.dev/>. Source: <https://github.com/ggmaddr/Autonomous-Traders-Lab> (`master`).

Cloudflare Pages is a **direct-upload project**: pushing GitHub code does not publish the website. The Pages production branch is `main`, even though the source repository uses `master`.

## 1. Push code and publish the website

Run commands from the repository root. First-time setup: `uv sync`, `npm install --prefix client`, and `npx wrangler login` (check an existing login with `npx wrangler whoami`). You also need `cloudflared` installed and GitHub push access as `ggmaddr`.

Keep these three processes running, each in its own terminal. Skip any process that is already running:

```sh
# Terminal 1: private API, using the repository's accounts.db
uv run uvicorn server.api:app --host 127.0.0.1 --port 8000
```

```sh
# Terminal 2: public read-only gateway
uv run uvicorn server.public_web:app --host 127.0.0.1 --port 8010
```

```sh
# Terminal 3: expose ONLY the read-only gateway
cloudflared tunnel --url http://127.0.0.1:8010 --no-autoupdate
```

Copy the `https://…trycloudflare.com` URL printed by Terminal 3. In a fourth terminal, substitute that URL below:

```sh
PUBLIC_TUNNEL_ORIGIN=https://YOUR-CURRENT-TUNNEL.trycloudflare.com
curl --fail "$PUBLIC_TUNNEL_ORIGIN/api/traders"

# Build the UI and the Pages proxy, pointing at this tunnel.
uv run python scripts/prepare_pages.py "$PUBLIC_TUNNEL_ORIGIN"

# Commit and push all intended changes as ggmaddr.
git status --short --branch
git config --local user.name ggmaddr
git config --local user.email 102542221+ggmaddr@users.noreply.github.com
# Confirm the current branch is master before continuing.
git add -A
git commit -m "Describe your change"
git push origin master

# Publish the generated upload to the existing Pages production site.
npx wrangler pages deploy --cwd .cloudflare-pages --branch main
curl --fail https://grady-ta-antimats-lab.pages.dev/api/traders
```

The preparation script preserves the existing private visitor-check-in D1 binding in `.cloudflare-pages/wrangler.jsonc`. For a fresh checkout, supply the existing database ID once (this ID is not a credential):

```sh
uv run python scripts/prepare_pages.py "$PUBLIC_TUNNEL_ORIGIN" \
  --checkins-db 95e6962e-d0ca-454f-94fd-0e749c9d0562
```

Then run the Pages deploy command. Keep `.cloudflare-pages/` generated and ignored; upload through the preparation script rather than uploading the repository. See [visitor check-ins](VISITOR_CHECKINS.md) for database setup and private record review.

## 2. Fix “/api/traders failed: 503”

Starting `uvicorn server.api:app --port 8000` makes the API available **on your Mac**. The public site needs this entire chain:

```text
Browser → Pages /api/* → current Cloudflare tunnel → gateway :8010 → API :8000
```

On November 13, 2026, the API returned 200 locally, but the gateway and tunnel were stopped. Pages still pointed at an old tunnel, so it returned `Desktop connection is offline` with HTTP 503. The old UI's port-8000 hint was incomplete; it now displays the server's error detail and uses a separate public-site hint.

Check each hop in order:

| Check | Command | If it fails |
| --- | --- | --- |
| Private API | `curl --fail http://127.0.0.1:8000/api/traders` | Start Terminal 1 from the repo root; inspect its logs. |
| Read-only gateway | `curl --fail http://127.0.0.1:8010/api/traders` | Start Terminal 2; check the API on 8000. |
| Tunnel | `curl --fail "$PUBLIC_TUNNEL_ORIGIN/api/traders"` | Start Terminal 3 and copy its current URL. |
| Pages | `curl --fail https://grady-ta-antimats-lab.pages.dev/api/traders` | Re-run preparation with that URL, then deploy with `--branch main`. |

Use `curl -i URL` to see the status and error body. `Desktop connection is not configured` means the Pages `PUBLIC_API_ORIGIN` binding is missing or invalid; preparation plus redeployment sets it. `Desktop API unavailable` means the gateway cannot reach port 8000. After recovery, refresh the browser if it still shows the old error.

**Quick tunnels get a new URL when restarted.** After every tunnel restart, rebuild and redeploy with the new URL. The API, gateway, tunnel, and Mac/network must stay available; these commands do not install an automatic startup service. A sleeping or restarted Mac can take the data offline while Pages continues serving the UI. For unattended hosting, use an always-on backend or adapt the current quick-tunnel-only origin validation for a stable named tunnel.

For local-only use, run the API and `npm run dev --prefix client`, then open <http://localhost:5173>. That path uses Vite's local proxy and needs no Cloudflare tunnel.

Cloudflare references: [direct uploads](https://developers.cloudflare.com/pages/get-started/direct-upload/), [Pages configuration and production branches](https://developers.cloudflare.com/pages/functions/wrangler-configuration/), [quick tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).
