"""Offline regression tests; never reads or writes trading accounts."""
import json
import sqlite3
import tempfile
import unittest
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from . import active_traders as desk, database
from .accounts import Account


class ActiveDeskTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = patch.object(database, "DB", str(Path(self.tmp.name) / "test.db"))
        self.db.start()
        with sqlite3.connect(database.DB) as conn:
            conn.executescript("""
                CREATE TABLE accounts (name TEXT PRIMARY KEY, account TEXT);
                CREATE TABLE logs (id INTEGER PRIMARY KEY, name TEXT, datetime TEXT, type TEXT, message TEXT);
                CREATE TABLE runs (trace_id TEXT PRIMARY KEY, cycle_id TEXT, trader TEXT, mode TEXT,
                    strategy TEXT, account_before TEXT, account_after TEXT, output TEXT, error TEXT,
                    started_at TEXT, ended_at TEXT);
            """)
        desk.initialize()
        self.now = datetime(2026, 11, 9, 16, 0, tzinfo=timezone.utc)
        self.snapshot = {"open": True, "close": self.now + timedelta(hours=5),
                         "prices": {"SPY": 101.}, "bars": {"SPY": self.bars()}}

    def tearDown(self):
        self.db.stop()
        self.tmp.cleanup()

    def bars(self):
        return [{"t": (self.now - timedelta(minutes=20-i)).isoformat(), "c": 100.,
                 "h": 100.1, "v": 100, "vw": 100.} for i in range(20)]

    def test_momentum_entry_and_snapshot_mark(self):
        account = Account.get("Zoro")
        desk.decide(account, "Zoro", self.snapshot, self.now, "test")
        self.assertEqual(account.holdings, {"SPY": 14})
        self.assertAlmostEqual(account.transactions[0].price, 101 * 1.002)
        self.assertLessEqual(account.holdings["SPY"] * 101, 1500)
        with patch("server.accounts.quote", side_effect=AssertionError("No Massive calls")):
            self.assertAlmostEqual(account.calculate_portfolio_value(), 10000 - 14 * 101 * .002)

    def test_reversion_is_a_distinct_entry(self):
        rows = self.bars()
        rows[-2]["c"], rows[-1]["c"] = 99.5, 99.6
        snap = {**self.snapshot, "prices": {"SPY": 99.6}, "bars": {"SPY": rows}}
        sanji, zoro = Account.get("Sanji"), Account.get("Zoro")
        desk.decide(sanji, "Sanji", snap, self.now, "test")
        desk.decide(zoro, "Zoro", snap, self.now, "test")
        self.assertIn("SPY", sanji.holdings)
        self.assertFalse(zoro.holdings)

    def test_time_exit_does_not_reenter_until_cooldown(self):
        account = Account.get("Zoro")
        desk.decide(account, "Zoro", self.snapshot, self.now, "test")
        later = self.now + timedelta(minutes=21)
        desk.decide(account, "Zoro", self.snapshot, later, "test2")
        self.assertFalse(account.holdings)
        self.assertEqual(len(account.transactions), 2)
        self.assertGreater(account.balance, 0)
        self.assertLess(account.balance, 10000)  # unchanged market still pays round-trip costs

    def test_flatten_before_early_close(self):
        account = Account.get("Zoro")
        desk.decide(account, "Zoro", self.snapshot, self.now, "test")
        snap = {**self.snapshot, "close": self.now + timedelta(minutes=5)}
        desk.decide(account, "Zoro", snap, self.now, "test2")
        self.assertFalse(account.holdings)
        self.assertIn("flatten", account.transactions[-1].rationale)

    def test_sanji_rebound_exit(self):
        account = Account.get("Sanji")
        desk.fill(account, "SPY", 10, 99.6, "entry", "test", self.now)
        snap = {**self.snapshot, "prices": {"SPY": 100.}}
        desk.decide(account, "Sanji", snap, self.now, "test2")
        self.assertFalse(account.holdings)
        self.assertIn("VWAP", account.transactions[-1].rationale)

    def test_missing_quotes_never_fill(self):
        account = Account.get("Zoro")
        desk.decide(account, "Zoro", {**self.snapshot, "prices": {}}, self.now, "test")
        self.assertFalse(account.transactions)

    def test_stale_bars_never_enter(self):
        self.assertFalse(desk.signal("Zoro", self.bars(), 101, self.now + timedelta(minutes=10))[0])

    def test_daily_cap_does_not_block_exits(self):
        account = Account.get("Zoro")
        for i in range(30):
            at = self.now - timedelta(minutes=100-i)
            desk.fill(account, "SPY", 1, 100, "entry", "test", at)
            if i < 29:
                desk.fill(account, "SPY", -1, 100, "exit", "test", at)
        desk.decide(account, "Zoro", self.snapshot, self.now, "test")
        self.assertFalse(account.holdings)
        self.assertEqual(sum(t.quantity > 0 for t in account.transactions), 30)

    def test_four_position_limit(self):
        account = Account.get("Zoro")
        snap = {**self.snapshot, "prices": {s: 101 for s in desk.UNIVERSE},
                "bars": {s: self.bars() for s in desk.UNIVERSE}}
        desk.decide(account, "Zoro", snap, self.now, "test")
        self.assertEqual(len(account.holdings), 4)
        self.assertGreaterEqual(account.balance, 0)

    def test_initialization_preserves_existing_money(self):
        account = Account.get("Zoro")
        account.balance = 9876
        account.save()
        desk.initialize()
        self.assertEqual(Account.get("Zoro").balance, 9876)

    def test_quote_age_guard(self):
        data = [{"is_open": True, "next_close": self.snapshot["close"].isoformat()},
                {"bars": {}}, {"trades": {
                    "SPY": {"p": 100, "t": (self.now - timedelta(minutes=10)).isoformat()},
                    "QQQ": {"p": 101, "t": self.now.isoformat()}}}]
        with patch.object(desk, "_get", side_effect=data):
            self.assertEqual(desk.market_snapshot(self.now)["prices"], {"QQQ": 101})

    def test_closed_market_and_feed_failure_record_no_trades(self):
        for snapshot, error in [({"open": False}, None), (None, RuntimeError("feed down"))]:
            with patch.object(desk, "market_snapshot", return_value=snapshot, side_effect=error), \
                 patch.object(desk, "trace", return_value=nullcontext()):
                desk.run_once(self.now)
            self.assertFalse(Account.get("Zoro").transactions)
        with sqlite3.connect(database.DB) as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM runs WHERE error IS NOT NULL").fetchone()[0], 2)

    def test_run_records_fills_snapshots_and_serializable_trace(self):
        def span(name, data):
            json.dumps(data)
            return nullcontext()
        with patch.object(desk, "market_snapshot", return_value=self.snapshot), \
             patch.object(desk, "trace", return_value=nullcontext()), patch.object(desk, "custom_span", side_effect=span):
            desk.run_once(self.now)
        account = Account.get("Zoro")
        self.assertTrue(account.transactions[0].trace_id)
        self.assertEqual(len(account.portfolio_value_time_series), 2)
        with sqlite3.connect(database.DB) as conn:
            row = conn.execute("SELECT output, error FROM runs WHERE trader='zoro'").fetchone()
        self.assertIn("Bought SPY", row[0])
        self.assertIsNone(row[1])


if __name__ == "__main__":
    unittest.main()
