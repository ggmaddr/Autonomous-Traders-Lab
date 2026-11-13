"""Build a public-only Pages upload, excluding all desktop state and secrets.

Usage: uv run python scripts/prepare_pages.py https://example.trycloudflare.com
Then: npx wrangler pages deploy --cwd .cloudflare-pages --branch main
"""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("origin", help="Current HTTPS URL of the view-only Cloudflare tunnel")
parser.add_argument("--checkins-db", help="Cloudflare D1 database ID for private visitor check-ins")
args = parser.parse_args()
origin = args.origin.rstrip("/")
if not re.fullmatch(r"https://[a-z0-9-]+\.trycloudflare\.com", origin):
    parser.error("Expected an HTTPS trycloudflare.com hostname")
subprocess.run(["npm", "run", "build", "--prefix", "client"], cwd=ROOT, check=True)
output = ROOT / ".cloudflare-pages"
dist = output / "dist"
output.mkdir(exist_ok=True)
# Preserve an existing private database binding on subsequent routine uploads.
if not args.checkins_db and (output / "wrangler.jsonc").exists():
    previous = json.loads((output / "wrangler.jsonc").read_text())
    args.checkins_db = next((item["database_id"] for item in previous.get("d1_databases", []) if item.get("binding") == "CHECKINS"), None)
if dist.exists():
    shutil.rmtree(dist)  # This script owns this generated upload directory only.
shutil.copytree(ROOT / "client/dist", dist)
index = dist / "index.html"
meta = '<head><meta name="view-only" content="true">'
if args.checkins_db:
    meta += '<meta name="visitor-checkin" content="true">'
index.write_text(index.read_text().replace("<head>", meta, 1))
worker = (ROOT / "deploy/cloudflare/worker.mjs").read_text()
checkins = (ROOT / "deploy/cloudflare/checkins.mjs").read_text().replace("export async function", "async function")
(dist / "_worker.js").write_text(checkins + "\n" + worker.replace("import { checkIn } from './checkins.mjs';\n", ""))
(dist / "_routes.json").write_text(json.dumps({"version": 1, "include": ["/api/*"], "exclude": []}))
(dist / "_headers").write_text("/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Robots-Tag: noindex, nofollow\n")
(output / "wrangler.jsonc").write_text(json.dumps({
    "name": "grady-ta-antimats-lab",
    "pages_build_output_dir": "./dist",
    "compatibility_date": "2026-11-09",
    "vars": {"PUBLIC_API_ORIGIN": origin},
    **({"d1_databases": [{"binding": "CHECKINS", "database_name": "antimat-visitor-checkins", "database_id": args.checkins_db}]} if args.checkins_db else {}),
}, indent=2) + "\n")
print("Prepared view-only Pages site: grady-ta-antimats-lab")
print("Upload directory:", dist)
