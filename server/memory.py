"""Each researcher's knowledge graph, memory/<Name>.db, as mcp-memory-libsql stores it:
entities, relations between them, and observations on each entity. The API reads it
directly; the lesson review writes its lessons into it with the same schema, so the
researcher finds them with its own memory tools (search_nodes, read_graph).
"""

import re
import sqlite3
from pathlib import Path

MEMORY_DIR = Path("memory")
LESSON_TYPE = "Lesson"
PATTERN_TYPE = "Pattern"
LESSON_NAME = re.compile(r"^Lesson (\d+)\b")

# The server creates these on start; the review may write first, so it creates them too.
SCHEMA = """
CREATE TABLE IF NOT EXISTS entities (
    name TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (entity_name) REFERENCES entities(name)
);
CREATE TABLE IF NOT EXISTS relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source) REFERENCES entities(name),
    FOREIGN KEY (target) REFERENCES entities(name)
);
"""


def path_of(trader: str) -> Path:
    return MEMORY_DIR / f"{trader.capitalize()}.db"


def lesson_name(lesson_id: int, symbol: str) -> str:
    return f"Lesson {lesson_id} {symbol}"


def lesson_id_of(name: str) -> int | None:
    m = LESSON_NAME.match(name)
    return int(m.group(1)) if m else None


def pattern_name(pattern: str) -> str:
    return f"Pattern {pattern}"


def _iso(stamp: str | None) -> str | None:
    """SQLite CURRENT_TIMESTAMP is UTC without a zone; say so."""
    return f"{stamp.replace(' ', 'T')}Z" if stamp else None


def read_graph(trader: str) -> dict:
    """The whole graph. Relations may name an entity that was never created or was
    deleted; those ends come back as nodes with no type, so no edge points nowhere."""
    path = path_of(trader)
    if not path.exists():
        return {"exists": False, "nodes": [], "edges": []}
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row
        try:
            entities = conn.execute("SELECT name, entity_type, created_at FROM entities ORDER BY created_at").fetchall()
            observations = conn.execute(
                "SELECT id, entity_name, content, created_at FROM observations ORDER BY id"
            ).fetchall()
            relations = conn.execute(
                "SELECT id, source, target, relation_type, created_at FROM relations ORDER BY id"
            ).fetchall()
        except sqlite3.OperationalError:
            return {"exists": True, "nodes": [], "edges": []}
    nodes = {
        e["name"]: {
            "name": e["name"],
            "type": e["entity_type"],
            "created_at": _iso(e["created_at"]),
            "lesson_id": lesson_id_of(e["name"]) if e["entity_type"] == LESSON_TYPE else None,
            "observations": [],
        }
        for e in entities
    }
    for o in observations:
        node = nodes.get(o["entity_name"])
        if node:
            node["observations"].append({"id": o["id"], "content": o["content"], "created_at": _iso(o["created_at"])})
    edges = []
    for r in relations:
        for end in (r["source"], r["target"]):
            nodes.setdefault(end, {"name": end, "type": None, "created_at": None, "lesson_id": None, "observations": []})
        edges.append(
            {
                "id": r["id"],
                "source": r["source"],
                "target": r["target"],
                "type": r["relation_type"],
                "created_at": _iso(r["created_at"]),
            }
        )
    return {"exists": True, "nodes": list(nodes.values()), "edges": edges}


def write_lesson(trader: str, lesson_id: int, symbol: str, pattern: str, observations: list[str]):
    """The lesson as an entity of its own, linked to the symbol it is about and the
    pattern it follows. The symbol entity is created only if the researcher has not
    already stored one under that name."""
    name = lesson_name(lesson_id, symbol)
    path = path_of(trader)
    path.parent.mkdir(exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.executescript(SCHEMA)
        for entity, kind in ((name, LESSON_TYPE), (symbol, "Stock"), (pattern_name(pattern), PATTERN_TYPE)):
            conn.execute("INSERT OR IGNORE INTO entities (name, entity_type) VALUES (?, ?)", (entity, kind))
        conn.executemany(
            "INSERT INTO observations (entity_name, content) VALUES (?, ?)", [(name, o) for o in observations]
        )
        conn.executemany(
            "INSERT INTO relations (source, target, relation_type) VALUES (?, ?, ?)",
            [(name, symbol, "about"), (name, pattern_name(pattern), "follows")],
        )


def write_contradiction(trader: str, later: str, earlier: list[str], note: str):
    """A later lesson that points the other way: an edge to each earlier one, and a
    note on the earlier one so a recall of it carries the contradiction."""
    with sqlite3.connect(path_of(trader)) as conn:
        conn.executemany(
            "INSERT INTO relations (source, target, relation_type) VALUES (?, ?, 'contradicts')",
            [(later, e) for e in earlier],
        )
        conn.executemany(
            "INSERT INTO observations (entity_name, content) VALUES (?, ?)", [(e, note) for e in earlier]
        )


def write_graph(trader: str, entities: list[tuple[str, str]], observations: list[tuple[str, str]],
                relations: list[tuple[str, str, str]]):
    """Add entities, observations and relations, skipping any already stored, so a writer
    that runs every day does not pile up copies (plan §4.4.4 Memory bloat)."""
    path = path_of(trader)
    path.parent.mkdir(exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.executescript(SCHEMA)
        conn.executemany("INSERT OR IGNORE INTO entities (name, entity_type) VALUES (?, ?)", entities)
        for entity, content in observations:
            if not conn.execute("SELECT 1 FROM observations WHERE entity_name = ? AND content = ?", (entity, content)).fetchone():
                conn.execute("INSERT INTO observations (entity_name, content) VALUES (?, ?)", (entity, content))
        for source, target, kind in relations:
            if not conn.execute("SELECT 1 FROM relations WHERE source = ? AND target = ? AND relation_type = ?",
                                (source, target, kind)).fetchone():
                conn.execute("INSERT INTO relations (source, target, relation_type) VALUES (?, ?, ?)", (source, target, kind))


def has_observation(trader: str, entity: str, prefix: str) -> bool:
    path = path_of(trader)
    if not path.exists():
        return False
    with sqlite3.connect(path) as conn:
        conn.executescript(SCHEMA)
        return conn.execute("SELECT 1 FROM observations WHERE entity_name = ? AND content LIKE ?",
                            (entity, prefix.replace("%", "") + "%")).fetchone() is not None
