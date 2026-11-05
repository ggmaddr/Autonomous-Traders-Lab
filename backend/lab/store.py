"""Experiment storage in accounts.db. An experiment is a spec (scenarios, the values
chosen per dimension, trials per arm) and a manifest of everything that could change a
result. Its trials are created up front, queued, so progress is a count of rows. A
trial keeps what the SDK spans do not: the sandbox's orders and final portfolio, and
its grades. The model and tool calls stay in the spans, under the trial's trace_id.
"""

import json
import sqlite3
from datetime import datetime, timezone

from ..database import DB

JSON_COLS = {"spec", "manifest", "arm", "result", "grades"}

with sqlite3.connect(DB) as conn:
    conn.execute('''
        CREATE TABLE IF NOT EXISTS experiments (
            id TEXT PRIMARY KEY,
            name TEXT,
            spec TEXT,
            manifest TEXT,
            status TEXT,
            created_at TEXT,
            started_at TEXT,
            ended_at TEXT
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS trials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            experiment_id TEXT,
            seq INTEGER,
            scenario_id TEXT,
            arm_id TEXT,
            arm TEXT,
            trial INTEGER,
            status TEXT,
            trace_id TEXT,
            started_at TEXT,
            ended_at TEXT,
            result TEXT,
            grades TEXT,
            error TEXT
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_trials_experiment ON trials(experiment_id)')
    conn.execute('CREATE TABLE IF NOT EXISTS lab_worker (id INTEGER PRIMARY KEY CHECK (id = 1), seen_at TEXT, pid INTEGER, busy TEXT)')


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(r: sqlite3.Row) -> dict:
    return {k: json.loads(r[k]) if k in JSON_COLS and r[k] else r[k] for k in r.keys()}


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


def create_experiment(exp_id: str, name: str, spec: dict, manifest: dict, trials: list[dict]):
    with _conn() as conn:
        conn.execute(
            'INSERT INTO experiments (id, name, spec, manifest, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            (exp_id, name, json.dumps(spec), json.dumps(manifest), "queued", now()),
        )
        conn.executemany(
            'INSERT INTO trials (experiment_id, seq, scenario_id, arm_id, arm, trial, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [(exp_id, i, t["scenario_id"], t["arm_id"], json.dumps(t["arm"]), t["trial"], "queued") for i, t in enumerate(trials)],
        )


def experiments() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute('SELECT * FROM experiments ORDER BY created_at DESC').fetchall()
        counts = conn.execute('SELECT experiment_id, status, COUNT(*) n FROM trials GROUP BY experiment_id, status').fetchall()
    progress: dict[str, dict] = {}
    for c in counts:
        progress.setdefault(c["experiment_id"], {})[c["status"]] = c["n"]
    return [{**_row(r), "progress": progress.get(r["id"], {})} for r in rows]


def experiment(exp_id: str) -> dict | None:
    with _conn() as conn:
        row = conn.execute('SELECT * FROM experiments WHERE id = ?', (exp_id,)).fetchone()
    return _row(row) if row else None


def trials(exp_id: str) -> list[dict]:
    with _conn() as conn:
        rows = conn.execute('SELECT * FROM trials WHERE experiment_id = ? ORDER BY seq', (exp_id,)).fetchall()
    return [_row(r) for r in rows]


def trial(trial_id: int) -> dict | None:
    with _conn() as conn:
        row = conn.execute('SELECT * FROM trials WHERE id = ?', (trial_id,)).fetchone()
    return _row(row) if row else None


def next_trial() -> dict | None:
    """The next queued trial of the oldest experiment that is not finished or cancelled."""
    with _conn() as conn:
        row = conn.execute('''
            SELECT t.* FROM trials t JOIN experiments e ON e.id = t.experiment_id
            WHERE t.status = 'queued' AND e.status IN ('queued', 'running')
            ORDER BY e.created_at, t.seq LIMIT 1
        ''').fetchone()
    return _row(row) if row else None


def set_experiment(exp_id: str, **fields):
    cols = ", ".join(f"{k} = ?" for k in fields)
    with _conn() as conn:
        conn.execute(f'UPDATE experiments SET {cols} WHERE id = ?', (*fields.values(), exp_id))


def set_trial(trial_id: int, **fields):
    values = [json.dumps(v) if k in JSON_COLS else v for k, v in fields.items()]
    cols = ", ".join(f"{k} = ?" for k in fields)
    with _conn() as conn:
        conn.execute(f'UPDATE trials SET {cols} WHERE id = ?', (*values, trial_id))


def finish_if_done(exp_id: str):
    with _conn() as conn:
        left = conn.execute(
            "SELECT COUNT(*) FROM trials WHERE experiment_id = ? AND status IN ('queued', 'running')", (exp_id,)
        ).fetchone()[0]
    if not left:
        set_experiment(exp_id, status="done", ended_at=now())


def cancel(exp_id: str):
    with _conn() as conn:
        conn.execute("UPDATE trials SET status = 'cancelled' WHERE experiment_id = ? AND status = 'queued'", (exp_id,))
        conn.execute("UPDATE experiments SET status = 'cancelled', ended_at = ? WHERE id = ? AND status IN ('queued', 'running')",
                     (now(), exp_id))


def requeue_orphans():
    """Trials left running when the worker stopped go back in the queue."""
    with _conn() as conn:
        conn.execute("UPDATE trials SET status = 'queued', started_at = NULL WHERE status = 'running'")


def heartbeat(pid: int, busy: str | None):
    with _conn() as conn:
        conn.execute('INSERT INTO lab_worker (id, seen_at, pid, busy) VALUES (1, ?, ?, ?) '
                     'ON CONFLICT(id) DO UPDATE SET seen_at = excluded.seen_at, pid = excluded.pid, busy = excluded.busy',
                     (now(), pid, busy))


def worker() -> dict | None:
    with _conn() as conn:
        row = conn.execute('SELECT * FROM lab_worker WHERE id = 1').fetchone()
    return dict(row) if row else None


def trial_seconds() -> list[float]:
    """How long finished trials took, for the time estimate."""
    with _conn() as conn:
        rows = conn.execute("SELECT started_at, ended_at FROM trials WHERE status = 'done' AND started_at IS NOT NULL").fetchall()
    return [(datetime.fromisoformat(r[1]) - datetime.fromisoformat(r[0])).total_seconds() for r in rows]
