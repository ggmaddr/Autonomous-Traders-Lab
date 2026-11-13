# Visitor check-ins

Cloudflare Pages requires a nonblank name or nickname in a native dialog before exploring, once per browser-tab session. There is no skip option, and Escape cannot dismiss it. The dialog stays open on network or storage failures so visitors can retry. `sessionStorage` remembers a successful named check-in across refreshes; a fresh browser/tab normally asks again. Browser session restoration and duplicated tabs may preserve this state. When storage is disabled, completion lasts only until reload. Sessions that skipped the earlier optional prompt must check in again.

Submitting saves a random session UUID, self-reported name, server UTC time, and entry pathname to a private Cloudflare D1 database. No query strings, visitor IPs, emails, or browser fingerprints are stored by this feature. Hosting providers may maintain their own standard request logs. The API rejects blank names and anonymous submissions. Historical anonymous records remain in the database. Visits that never submit the popup are not recorded. This is a guestbook UI requirement, not authentication or a complete visitor analytics system; it does not protect the public data API.

There is no public read/list endpoint. Other public trading write endpoints remain blocked. The check-in handler requires same-origin JSON, caps bodies at 2 KiB, validates names (80 characters), binds SQL parameters, deduplicates retries, and limits new records to 60 per rolling minute globally. This ceiling limits writes; it is not comprehensive anti-abuse or DDoS protection.

## Deploy

Create `antimat-visitor-checkins` with `wrangler d1 create`, then apply `deploy/cloudflare/checkins.sql` using `wrangler d1 execute antimat-visitor-checkins --remote --file deploy/cloudflare/checkins.sql`.

Build using `uv run python scripts/prepare_pages.py CURRENT_TUNNEL_ORIGIN --checkins-db DATABASE_ID`, then `npx wrangler pages deploy --cwd .cloudflare-pages --branch main`. The check-in prompt is enabled only in uploads configured with a D1 binding. The local/private dashboard does not prompt.

## Review privately

In the Cloudflare dashboard, open **Storage & databases → D1 → antimat-visitor-checkins → Console**, then run:

```sql
SELECT CASE WHEN name = '' THEN 'Anonymous' ELSE name END AS visitor, session_id, created_at, entry_path
FROM visitor_checkins
ORDER BY created_at DESC
LIMIT 100;
```

Or from this repository:

```sh
npx wrangler d1 execute antimat-visitor-checkins --remote --command "SELECT CASE WHEN name = '' THEN 'Anonymous' ELSE name END AS visitor, session_id, created_at, entry_path FROM visitor_checkins ORDER BY created_at DESC LIMIT 100"
```

Records persist until deleted by the owner. Names are unverified and should be treated as user-supplied text. A person can use any nickname or check in from multiple sessions. Each record is a session entry, not a count of every page view. Do not interpret record counts as unique people.

## Verify

`node --test deploy/cloudflare/checkins.test.mjs`

The production frontend build checks the React integration. Browser QA covers submit, reload, fresh tab/browser, blank-name rejection, network failure, and Escape staying blocked.
