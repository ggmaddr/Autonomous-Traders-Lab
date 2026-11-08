"""Luffy, the day trader: one technique, the opening range breakout (server/orb.py), and
never a position overnight.

The agent trades the setups the Day-Trade desk computes. Being flat by the close is not
left to the model: the floor wakes at 15:50 New York and sells whatever Luffy still holds,
and at any cycle it first sells positions carried over from an earlier session (a missed
close, or the floor was stopped). These orders are deterministic and carry no trace.
"""

from datetime import datetime, timezone

from .accounts import Account
from .orb import CLOSE, FLATTEN_AT
from .quant.bars import NY

NAME = "Luffy"
MODE = "daytrade"


def _ny(now: datetime | None = None) -> datetime:
    return (now or datetime.now(timezone.utc)).astimezone(NY)


def seconds_to_flatten(now: datetime | None = None) -> float | None:
    """Seconds until today's 15:50 New York, or None when that has passed or it is a weekend."""
    ny = _ny(now)
    if ny.weekday() >= 5:
        return None
    at = datetime.combine(ny.date(), FLATTEN_AT, NY)
    left = (at - ny).total_seconds()
    return left if left > 0 else None


def in_flatten_window(now: datetime | None = None) -> bool:
    ny = _ny(now)
    return ny.weekday() < 5 and FLATTEN_AT <= ny.time() < CLOSE


def carried_over(account: Account, now: datetime | None = None) -> list[str]:
    """Held symbols last bought on an earlier New York day than today."""
    today = _ny(now).date().isoformat()
    out = []
    for sym, qty in account.holdings.items():
        if not qty:
            continue
        last = next((t for t in reversed(account.transactions) if t.symbol == sym and t.quantity > 0), None)
        if last and last.timestamp[:10] < today:
            out.append(sym)
    return out


def flatten(reason: str, symbols: list[str] | None = None) -> list[str]:
    """Sell the whole position in each symbol (all holdings when none are given)."""
    account = Account.get(NAME)
    done = []
    for sym in list(symbols if symbols is not None else account.holdings):
        qty = account.holdings.get(sym, 0)
        if not qty:
            continue
        try:
            account.sell_shares(sym, qty, reason)
            done.append(f"{qty} {sym}")
        except Exception as e:
            print(f"Luffy could not flatten {sym}: {type(e).__name__}: {e}")
    return done
