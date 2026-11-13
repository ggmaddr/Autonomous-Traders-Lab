"""Identity migration regression tests use temporary databases only."""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from .rename_traders import migrate, rename, SWAP
from . import database, runs


class TraderRenameTests(unittest.TestCase):
    def test_swap_keeps_money_memory_links_and_trace_ownership(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'memory').mkdir()
            db = root / 'accounts.db'
            with sqlite3.connect(db) as conn:
                conn.executescript('''
                    CREATE TABLE accounts (name TEXT PRIMARY KEY, account TEXT);
                    CREATE TABLE traces (trace_id TEXT PRIMARY KEY, name TEXT, metadata TEXT);
                    CREATE TABLE runs (trace_id TEXT PRIMARY KEY, trader TEXT);
                    CREATE TABLE spans (span_id TEXT PRIMARY KEY, trace_id TEXT, started_at TEXT, export TEXT);
                    CREATE TABLE lessons (id INTEGER PRIMARY KEY, trader TEXT, fill_ids TEXT, trace_ids TEXT);
                ''')
                for i, old in enumerate(SWAP):
                    name = old.lower()
                    trace = f'trace_{name}0historic'
                    account = {'name': name, 'balance': 9000 + i, 'holdings': {'SPY': i + 1},
                               'transactions': [{'trace_id': trace, 'quantity': i + 1, 'price': 99.25, 'rationale': f'{old}: entry'}]}
                    conn.execute('INSERT INTO accounts VALUES (?,?)', (name, json.dumps(account)))
                    conn.execute('INSERT INTO traces VALUES (?,?,?)', (trace, f'{old}-trading', json.dumps({'trader': old})))
                    conn.execute('INSERT INTO runs VALUES (?,?)', (trace, name))
                    for tool in ['Researcher', 'read_graph']:
                        export = {'id': f'span_{i}_{tool}', 'trace_id': trace, 'span_data': {'type': 'function', 'name': tool}}
                        conn.execute('INSERT INTO spans VALUES (?,?,?,?)', (export['id'], trace, str(i), json.dumps(export)))
                    conn.execute('INSERT INTO lessons VALUES (?,?,?,?)', (i, name, json.dumps([f'{name}-0']), json.dumps([trace])))
                    with sqlite3.connect(root / 'memory' / f'{old}.db') as memory:
                        memory.executescript('CREATE TABLE entities(name TEXT PRIMARY KEY, entity_type TEXT); CREATE TABLE observations(id INTEGER PRIMARY KEY, entity_name TEXT, content TEXT);')
                        memory.execute('INSERT INTO entities VALUES (?,?)', (f'{old} thesis', 'Thesis'))
                        memory.execute('INSERT INTO observations VALUES (?,?,?)', (i, f'{old} thesis', f'Owned by {old}; {trace}'))
            backup, _ = migrate(root)
            self.assertTrue((backup / 'original' / 'accounts.db').exists())
            with sqlite3.connect(db) as conn:
                for i, (old, new) in enumerate(SWAP.items()):
                    account = json.loads(conn.execute('SELECT account FROM accounts WHERE name=?', (new.lower(),)).fetchone()[0])
                    self.assertEqual(account['name'], new.lower())
                    self.assertEqual(account['balance'], 9000 + i)
                    self.assertEqual(account['holdings'], {'SPY': i + 1})
                    trace = f'trace_{old.lower()}0historic'
                    self.assertEqual(account['transactions'][0]['trace_id'], trace)
                    self.assertEqual(account['transactions'][0]['price'], 99.25)
                    self.assertEqual(conn.execute('SELECT trader FROM runs WHERE trace_id=?', (trace,)).fetchone()[0], new.lower())
                    lesson = conn.execute('SELECT fill_ids,trace_ids FROM lessons WHERE id=?', (i,)).fetchone()
                    self.assertEqual(json.loads(lesson[0]), [f'{new.lower()}-0'])
                    self.assertEqual(json.loads(lesson[1]), [trace])
                    with sqlite3.connect(root / 'memory' / f'{new}.db') as memory:
                        self.assertEqual(memory.execute('SELECT content FROM observations WHERE id=?', (i,)).fetchone()[0], f'Owned by {new}; {trace}')
            with patch.object(database, 'DB', str(db)):
                self.assertEqual(runs.trader_of('trace_jinbe0historic'), 'zoro')
                self.assertEqual(database.read_researcher_trace_ids('zoro'), ['trace_jinbe0historic'])
                self.assertEqual(database.read_tool_spans('jinbe', {'read_graph'})[0]['trace_id'], 'trace_zoro0historic')
            with self.assertRaisesRegex(RuntimeError, 'already applied'):
                migrate(root)

    def test_protected_ids_urls_and_financial_values(self):
        original = {'name': 'law', 'text': 'Law watches https://example.com/Law; trace_law0abc stays stable.', 'balance': 123.45}
        self.assertEqual(rename(original), {'name': 'sanji', 'text': 'Sanji watches https://example.com/Law; trace_law0abc stays stable.', 'balance': 123.45})
        self.assertEqual(rename('law of supply'), 'law of supply')
        self.assertEqual(rename({'trader': 'Law', 'symbol': 'LAW', 'holdings': {'LAW': 4}}),
                         {'trader': 'Sanji', 'symbol': 'LAW', 'holdings': {'LAW': 4}})


if __name__ == '__main__':
    unittest.main()
