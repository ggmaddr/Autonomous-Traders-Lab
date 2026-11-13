"""One-time identity swap, preserving strategy history and stable trace/span IDs.

Stop the floor, API, Lab worker and any memory MCP processes first. Run
`uv run -m server.rename_traders --apply` from the repository root. SQLite backups
and an exact file mapping are retained under accounts.db.identity-backups/.
"""
import argparse
import json
import os
import re
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

MIGRATION = 'value-zoro_macro-sanji_rules-jinbe-law_v1'
SWAP = {'Jinbe': 'Zoro', 'Law': 'Sanji', 'Zoro': 'Jinbe', 'Sanji': 'Law'}
NAMES = {variant(old): variant(new) for old, new in SWAP.items()
         for variant in (str.lower, str.upper, str.title)}
PROTECTED = re.compile(r'(https?://[^\s"<>]+|(?:trace|span)_[A-Za-z0-9]+)')
NAMED = re.compile(r'(?<![A-Za-z])(?:Jinbe|Law|Zoro|Sanji|JINBE|LAW|ZORO|SANJI)(?![A-Za-z])')
PREFIX = re.compile(r'(?<![A-Za-z])(?:jinbe|law|zoro|sanji)(?=-(?:\d|qarp|macro|rules|trading|rebalancing)|_strategy|_playbook)')
TABLES = {'accounts', 'logs', 'traces', 'spans', 'runs', 'lessons', 'experiments', 'trials',
          'entities', 'observations', 'relations'}


def rename(value, field=None):
    if field in {'symbol', 'symbols', 'ticker', 'tickers', 'holdings', 'last_quotes', 'universe', 'cik'}:
        return value  # LAW is also a real ticker; market identifiers never change.
    if isinstance(value, dict):
        return {rename(k): rename(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [rename(v) for v in value]
    if not isinstance(value, str):
        return value
    if value in NAMES:
        return NAMES[value]
    # SDK exports may contain JSON encoded inside JSON strings.
    if value.lstrip().startswith(('{', '[')):
        try:
            parsed = json.loads(value)
            changed = rename(parsed)
            return json.dumps(changed, ensure_ascii=False) if changed != parsed else value
        except (ValueError, TypeError):
            pass
    pieces = PROTECTED.split(value)
    for i in range(0, len(pieces), 2):
        pieces[i] = PREFIX.sub(lambda m: NAMES[m[0]], NAMED.sub(lambda m: NAMES[m[0]], pieces[i]))
    return ''.join(pieces)


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def rewrite_database(path):
    """Work only on a staged copy; rowids and every nonidentity value are retained."""
    changed = {}
    with sqlite3.connect(path) as conn:
        conn.execute('BEGIN IMMEDIATE')
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table in sorted(tables & TABLES):
            columns = [r[1] for r in conn.execute(f'PRAGMA table_info({quote(table)})')]
            rows = conn.execute(f'SELECT rowid, * FROM {quote(table)}').fetchall()
            updates = []
            for row in rows:
                # Historical experiment manifests retain their original hash provenance.
                values = [v if c == 'manifest' else rename(v, c) for c, v in zip(columns, row[1:])]
                if table == 'traces':
                    idx = columns.index('metadata')
                    metadata = json.loads(values[idx] or '{}')
                    tag = row[1 + columns.index('trace_id')].split('_', 1)[-1].split('0', 1)[0]
                    if not metadata.get('trader') and tag in NAMES:
                        metadata['trader'] = NAMES[tag]
                        values[idx] = json.dumps(metadata)
                if tuple(values) != row[1:]:
                    updates.append((*values, row[0]))
            # Avoid transient primary-key collisions during a two-way name swap.
            if table in {'accounts', 'entities'}:
                for row in updates:
                    conn.execute(f'UPDATE {quote(table)} SET name=? WHERE rowid=?',
                                 (f'__identity_swap_{row[-1]}__', row[-1]))
            setters = ','.join(f'{quote(c)}=?' for c in columns)
            conn.executemany(f'UPDATE {quote(table)} SET {setters} WHERE rowid=?', updates)
            changed[table] = len(updates)
        if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError(f'Integrity check failed: {path}')
    return changed


def migrate(root: Path):
    root = root.resolve()
    account = root / 'accounts.db'
    with sqlite3.connect(f'file:{account}?mode=ro', uri=True) as conn:
        if conn.execute("SELECT 1 FROM sqlite_master WHERE name='identity_migrations'").fetchone():
            if conn.execute('SELECT 1 FROM identity_migrations WHERE id=?', (MIGRATION,)).fetchone():
                raise RuntimeError('Identity swap already applied; refusing to swap histories back.')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = root / 'accounts.db.identity-backups' / stamp
    stage = backup / 'staged'
    stage.mkdir(parents=True)
    files = [account, *sorted((root / 'memory').glob('*.db'))]
    plan, summary = [], {}
    for source in files:
        relative = source.relative_to(root)
        destination = relative if source == account else relative.with_name(SWAP.get(source.stem, source.stem) + '.db')
        saved, staged = backup / 'original' / relative, stage / destination
        saved.parent.mkdir(parents=True, exist_ok=True)
        staged.parent.mkdir(parents=True, exist_ok=True)
        # Online backup includes committed WAL content, unlike copying a .db file.
        with sqlite3.connect(source) as src, sqlite3.connect(saved) as dst:
            if src.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()[0]:
                raise RuntimeError(f'Database still in use: {source}; stop writers before retrying.')
            src.backup(dst)
        shutil.copy2(saved, staged)
        summary[str(destination)] = rewrite_database(staged)
        plan.append((source, root / destination, saved, staged))
    with sqlite3.connect(stage / 'accounts.db') as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS identity_migrations (id TEXT PRIMARY KEY, applied_at TEXT, mapping TEXT)')
        conn.execute('INSERT INTO identity_migrations VALUES (?,?,?)', (MIGRATION, stamp, json.dumps(SWAP)))
    (backup / 'manifest.json').write_text(json.dumps({'mapping': SWAP, 'changes': summary,
        'files': [{'from': str(s), 'to': str(d), 'backup': str(b)} for s, d, b, _ in plan]}, indent=2))
    destinations = {d for _, d, _, _ in plan}
    for source in files:
        if any(Path(str(source) + suffix).exists() for suffix in ('-wal', '-shm', '-journal')):
            raise RuntimeError(f'Database sidecar still active: {source}; close all services before retrying.')
    try:
        for _, destination, _, staged in plan:
            os.replace(staged, destination)
        for source, _, _, _ in plan:
            if source not in destinations:
                source.unlink()
    except BaseException:
        for source, _, saved, _ in plan:
            shutil.copy2(saved, source)
        for destination in destinations - set(files):
            destination.unlink(missing_ok=True)
        raise
    return backup, summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Apply after all database writers/readers have stopped')
    args = parser.parse_args()
    if not args.apply:
        print(json.dumps(SWAP, indent=2))
        print('Preview only. Stop services, then pass --apply to migrate with backups.')
    else:
        folder, changes = migrate(Path.cwd())
        print(json.dumps({'backup': str(folder), 'changes': changes}, indent=2))
