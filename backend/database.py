import sqlite3
import json
from datetime import datetime
from dotenv import load_dotenv

load_dotenv(override=True)

DB = "accounts.db"


with sqlite3.connect(DB) as conn:
    cursor = conn.cursor()
    cursor.execute('CREATE TABLE IF NOT EXISTS accounts (name TEXT PRIMARY KEY, account TEXT)')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            datetime DATETIME,
            type TEXT,
            message TEXT
        )
    ''')
    # The SDK's own traces and spans, saved as exported (plan §6.2).
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS traces (
            trace_id TEXT PRIMARY KEY,
            name TEXT,
            group_id TEXT,
            metadata TEXT,
            started_at TEXT,
            ended_at TEXT
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS spans (
            span_id TEXT PRIMARY KEY,
            trace_id TEXT,
            parent_id TEXT,
            started_at TEXT,
            ended_at TEXT,
            export TEXT
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id)')
    # One row per trader run: what the SDK does not know, the money side.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS runs (
            trace_id TEXT PRIMARY KEY,
            cycle_id TEXT,
            trader TEXT,
            mode TEXT,
            strategy TEXT,
            account_before TEXT,
            account_after TEXT,
            output TEXT,
            error TEXT,
            started_at TEXT,
            ended_at TEXT
        )
    ''')
    # Lessons the post-cycle review wrote about a decision (plan §11.4). A decision is
    # the fills of one run in one symbol on one side; fill IDs are "<trader>-<index>",
    # the same IDs the frontend's ledger gives each transaction.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS lessons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trader TEXT,
            text TEXT,
            kind TEXT,
            fill_ids TEXT,
            trace_ids TEXT,
            "return" REAL,
            benchmark_return REAL,
            created_at TEXT,
            recalled_count INTEGER DEFAULT 0,
            contradicted_by INTEGER,
            symbol TEXT,
            side TEXT,
            pattern TEXT,
            horizon_days INTEGER,
            decided_at TEXT,
            review_trace_id TEXT
        )
    ''')
    conn.commit()

def write_account(name, account_dict):
    json_data = json.dumps(account_dict)
    with sqlite3.connect(DB) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO accounts (name, account)
            VALUES (?, ?)
            ON CONFLICT(name) DO UPDATE SET account=excluded.account
        ''', (name.lower(), json_data))
        conn.commit()

def read_account(name):
    with sqlite3.connect(DB) as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT account FROM accounts WHERE name = ?', (name.lower(),))
        row = cursor.fetchone()
        return json.loads(row[0]) if row else None
    
def write_log(name: str, type: str, message: str):
    """
    Write a log entry to the logs table.
    
    Args:
        name (str): The name associated with the log
        type (str): The type of log entry
        message (str): The log message
    """
    now = datetime.now().isoformat()
    
    with sqlite3.connect(DB) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO logs (name, datetime, type, message)
            VALUES (?, datetime('now'), ?, ?)
        ''', (name.lower(), type, message))
        conn.commit()

def read_log(name: str, last_n=10):
    """
    Read the most recent log entries for a given name.
    
    Args:
        name (str): The name to retrieve logs for
        last_n (int): Number of most recent entries to retrieve
        
    Returns:
        list: A list of tuples containing (datetime, type, message)
    """
    with sqlite3.connect(DB) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT datetime, type, message FROM logs 
            WHERE name = ? 
            ORDER BY datetime DESC
            LIMIT ?
        ''', (name.lower(), last_n))
        
        return reversed(cursor.fetchall())

def write_trace(trace_id: str, name: str, group_id: str | None, metadata: dict | None, started_at: str):
    with sqlite3.connect(DB) as conn:
        conn.execute('''
            INSERT INTO traces (trace_id, name, group_id, metadata, started_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(trace_id) DO NOTHING
        ''', (trace_id, name, group_id, json.dumps(metadata or {}), started_at))


def end_trace(trace_id: str, ended_at: str):
    with sqlite3.connect(DB) as conn:
        conn.execute('UPDATE traces SET ended_at = ? WHERE trace_id = ?', (ended_at, trace_id))


def write_span(export: dict):
    with sqlite3.connect(DB) as conn:
        conn.execute('''
            INSERT OR REPLACE INTO spans (span_id, trace_id, parent_id, started_at, ended_at, export)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (
            export["id"], export["trace_id"], export.get("parent_id"),
            export.get("started_at"), export.get("ended_at"), json.dumps(export, default=str),
        ))


def start_run(trace_id: str, cycle_id: str, trader: str, mode: str, strategy: str, account_before: str, started_at: str):
    with sqlite3.connect(DB) as conn:
        conn.execute('''
            INSERT OR REPLACE INTO runs (trace_id, cycle_id, trader, mode, strategy, account_before, started_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (trace_id, cycle_id, trader.lower(), mode, strategy, account_before, started_at))


def end_run(trace_id: str, account_after: str | None, output: str | None, error: str | None, ended_at: str):
    with sqlite3.connect(DB) as conn:
        conn.execute('''
            UPDATE runs SET account_after = ?, output = ?, error = ?, ended_at = ? WHERE trace_id = ?
        ''', (account_after, output, error, ended_at, trace_id))


def read_runs(trader: str | None = None, limit: int = 200) -> list[dict]:
    with sqlite3.connect(DB) as conn:
        conn.row_factory = sqlite3.Row
        sql = 'SELECT * FROM runs'
        args: tuple = ()
        if trader:
            sql += ' WHERE trader = ?'
            args = (trader.lower(),)
        rows = conn.execute(sql + ' ORDER BY started_at DESC LIMIT ?', (*args, limit)).fetchall()
        return [dict(r) for r in rows]


def read_run(trace_id: str) -> dict | None:
    with sqlite3.connect(DB) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute('SELECT * FROM runs WHERE trace_id = ?', (trace_id,)).fetchone()
        return dict(row) if row else None


def read_spans(trace_ids: list[str]) -> list[dict]:
    """Every saved span export for these traces, oldest first."""
    if not trace_ids:
        return []
    marks = ",".join("?" * len(trace_ids))
    with sqlite3.connect(DB) as conn:
        rows = conn.execute(
            f'SELECT export FROM spans WHERE trace_id IN ({marks}) ORDER BY started_at', trace_ids
        ).fetchall()
        return [json.loads(r[0]) for r in rows]


def read_researcher_trace_ids(trader: str | None = None, limit: int = 200) -> list[str]:
    """Traces that called the Researcher, newest first."""
    with sqlite3.connect(DB) as conn:
        sql = '''
            SELECT s.trace_id, MAX(s.started_at) AS t FROM spans s
            WHERE json_extract(s.export, '$.span_data.type') = 'function'
              AND json_extract(s.export, '$.span_data.name') = 'Researcher'
              AND s.trace_id NOT LIKE 'trace_lab0%'
        '''
        args: tuple = ()
        if trader:
            sql += " AND s.trace_id LIKE ?"
            args = (f"trace_{trader.lower()}0%",)
        sql += ' GROUP BY s.trace_id ORDER BY t DESC LIMIT ?'
        return [r[0] for r in conn.execute(sql, (*args, limit)).fetchall()]


LESSON_JSON = ("fill_ids", "trace_ids")


def write_lesson(lesson: dict) -> int:
    row = {k: json.dumps(v) if k in LESSON_JSON else v for k, v in lesson.items()}
    cols = ", ".join(f'"{k}"' for k in row)
    with sqlite3.connect(DB) as conn:
        cur = conn.execute(
            f'INSERT INTO lessons ({cols}) VALUES ({",".join("?" * len(row))})', tuple(row.values())
        )
        return cur.lastrowid


def read_lessons(trader: str | None = None) -> list[dict]:
    """Every lesson, oldest first."""
    with sqlite3.connect(DB) as conn:
        conn.row_factory = sqlite3.Row
        sql = 'SELECT * FROM lessons'
        args: tuple = ()
        if trader:
            sql += ' WHERE trader = ?'
            args = (trader.lower(),)
        rows = conn.execute(sql + ' ORDER BY id', args).fetchall()
    return [{k: json.loads(r[k] or "[]") if k in LESSON_JSON else r[k] for k in r.keys()} for r in rows]


def mark_contradicted(lesson_ids: list[int], by: int):
    with sqlite3.connect(DB) as conn:
        conn.executemany('UPDATE lessons SET contradicted_by = ? WHERE id = ?', [(by, i) for i in lesson_ids])


def set_recalled_counts(counts: dict[int, int]):
    with sqlite3.connect(DB) as conn:
        conn.executemany('UPDATE lessons SET recalled_count = ? WHERE id = ?', [(n, i) for i, n in counts.items()])


def read_tool_spans(trader: str, tool_names: set[str]) -> list[dict]:
    """Function spans calling these tools in one trader's traces, oldest first."""
    marks = ",".join("?" * len(tool_names))
    with sqlite3.connect(DB) as conn:
        rows = conn.execute(f'''
            SELECT export FROM spans
            WHERE trace_id LIKE ?
              AND json_extract(export, '$.span_data.type') = 'function'
              AND json_extract(export, '$.span_data.name') IN ({marks})
            ORDER BY started_at
        ''', (f"trace_{trader.lower()}0%", *tool_names)).fetchall()
    return [json.loads(r[0]) for r in rows]
