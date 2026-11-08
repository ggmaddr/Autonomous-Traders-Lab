"""Market data tables in accounts.db (plan §4.4.4 Plumbing). They hold market data and
what was computed from it, not traces; the Researcher runs that explain transitions
stay SDK traces, linked by trace_id.

- bars: daily bars, split and dividend adjusted, one source for every day.
- regimes: one row per day and model. The label is after the dwell rule; raw_label
  before it. features holds that day's inputs. Every row uses data up to its day only.
- signal_scores: the scoreboard as of a day, per model, signal, regime and window.
- market_events: the news behind each regime transition, from a traced Researcher run.
"""

import json
import sqlite3
from datetime import datetime, timezone

from ..database import DB

with sqlite3.connect(DB) as conn:
    conn.execute('''
        CREATE TABLE IF NOT EXISTS bars (
            symbol TEXT,
            day TEXT,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume REAL,
            source TEXT,
            PRIMARY KEY (symbol, day)
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS regimes (
            day TEXT,
            model TEXT,
            label TEXT,
            raw_label TEXT,
            prob REAL,
            probs TEXT,
            features TEXT,
            version TEXT,
            computed_at TEXT,
            PRIMARY KEY (day, model)
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS signal_scores (
            as_of TEXT,
            model TEXT,
            signal TEXT,
            regime TEXT,
            window TEXT,
            n_days INTEGER,
            n_episodes INTEGER,
            ann_return REAL,
            hit_rate REAL,
            sharpe REAL,
            ci_lo REAL,
            ci_hi REAL,
            PRIMARY KEY (as_of, model, signal, regime, window)
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS market_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            day TEXT,
            model TEXT,
            from_label TEXT,
            to_label TEXT,
            headline TEXT,
            summary TEXT,
            sources TEXT,
            trace_id TEXT,
            created_at TEXT,
            UNIQUE (day, model)
        )
    ''')


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


def write_bars(rows: list[tuple]) -> None:
    """Rows of (symbol, day, open, high, low, close, volume, source), replacing what is there:
    adjusted history changes after every split and dividend, so it is reloaded whole."""
    with _conn() as conn:
        conn.executemany('INSERT OR REPLACE INTO bars VALUES (?, ?, ?, ?, ?, ?, ?, ?)', rows)


def read_bars(symbols: list[str] | None = None, until: str | None = None) -> list[sqlite3.Row]:
    q, args = 'SELECT * FROM bars WHERE 1=1', []
    if symbols:
        q += f' AND symbol IN ({",".join("?" * len(symbols))})'
        args += symbols
    if until:
        q += ' AND day <= ?'
        args.append(until)
    with _conn() as conn:
        return conn.execute(q + ' ORDER BY day', args).fetchall()


def bar_stats() -> dict:
    with _conn() as conn:
        r = conn.execute('SELECT COUNT(*) n, COUNT(DISTINCT symbol) symbols, MIN(day) first, MAX(day) last FROM bars').fetchone()
        return dict(r)


def last_closes(symbols: list[str]) -> dict[str, tuple[str, float]]:
    """Each symbol's latest close and its day, for symbols that have bars."""
    if not symbols:
        return {}
    with _conn() as conn:
        rows = conn.execute(
            f'''SELECT symbol, day, close FROM bars b WHERE symbol IN ({",".join("?" * len(symbols))})
                AND day = (SELECT MAX(day) FROM bars WHERE symbol = b.symbol)''', symbols).fetchall()
    return {r["symbol"]: (r["day"], r["close"]) for r in rows}


def write_regimes(model: str, version: str, rows: list[dict]) -> None:
    at = now()
    with _conn() as conn:
        conn.execute('DELETE FROM regimes WHERE model = ?', (model,))
        conn.executemany(
            'INSERT INTO regimes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [(r["day"], model, r["label"], r["raw_label"], r.get("prob"),
              json.dumps(r["probs"]) if r.get("probs") else None, json.dumps(r["features"]), version, at)
             for r in rows])


def read_regimes(model: str, start: str | None = None, until: str | None = None) -> list[dict]:
    q, args = 'SELECT * FROM regimes WHERE model = ?', [model]
    if start:
        q += ' AND day >= ?'
        args.append(start)
    if until:
        q += ' AND day <= ?'
        args.append(until)
    with _conn() as conn:
        rows = conn.execute(q + ' ORDER BY day', args).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["probs"] = json.loads(d["probs"]) if d["probs"] else None
        d["features"] = json.loads(d["features"]) if d["features"] else {}
        out.append(d)
    return out


def write_scores(as_of: str, model: str, rows: list[dict]) -> None:
    with _conn() as conn:
        conn.execute('DELETE FROM signal_scores WHERE as_of = ? AND model = ?', (as_of, model))
        conn.executemany(
            'INSERT INTO signal_scores VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [(as_of, model, r["signal"], r["regime"], r["window"], r["n_days"], r["n_episodes"],
              r["ann_return"], r["hit_rate"], r["sharpe"], r["ci_lo"], r["ci_hi"]) for r in rows])


def read_scores(model: str, as_of: str | None = None) -> tuple[str | None, list[dict]]:
    """The scoreboard as of a day (the latest one on or before it when None is given)."""
    with _conn() as conn:
        q = 'SELECT MAX(as_of) FROM signal_scores WHERE model = ?' + (' AND as_of <= ?' if as_of else '')
        day = conn.execute(q, (model, as_of) if as_of else (model,)).fetchone()[0]
        if not day:
            return None, []
        rows = conn.execute('SELECT * FROM signal_scores WHERE model = ? AND as_of = ?', (model, day)).fetchall()
    return day, [dict(r) for r in rows]


def write_event(e: dict) -> None:
    with _conn() as conn:
        conn.execute(
            '''INSERT OR REPLACE INTO market_events (day, model, from_label, to_label, headline, summary, sources, trace_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (e["day"], e["model"], e["from_label"], e["to_label"], e["headline"], e["summary"],
             json.dumps(e["sources"]), e.get("trace_id"), now()))


def read_events(model: str, start: str | None = None) -> list[dict]:
    with _conn() as conn:
        rows = conn.execute('SELECT * FROM market_events WHERE model = ? AND day >= ? ORDER BY day',
                            (model, start or "")).fetchall()
    return [{**dict(r), "sources": json.loads(r["sources"] or "[]")} for r in rows]
