"""Scenarios for the Experiment Lab (plan §5.2, §10). Each is one decision point on a
frozen market: start prices, a scripted forward path per symbol, the documents the
researcher can find, and the actions that count as a pass or a partial. The tickers
are synthetic aliases, so the model cannot recall what happened next.

Grading and the baselines live here too, because both are pure functions of the
scenario: given the orders that filled, what grade and what return.
"""

import hashlib
import random
from dataclasses import dataclass, field
from pathlib import Path

import yaml

SCENARIO_DIR = Path(__file__).parent / "scenarios"
SPREAD = 0.002  # half-spread on every fill, as in backend/accounts.py
BENCHMARK = "SPY"
RANDOM_DRAWS = 400


@dataclass
class Scenario:
    id: str
    version: int
    title: str
    family: str
    question: str
    task: str  # trade | rebalance
    as_of: str
    horizon_days: int
    universe: dict[str, dict]
    cash: float
    positions: dict[str, int]
    documents: list[dict]
    evidence_terms: list[str]
    grading: dict[str, list[dict]]
    digest: str = field(default="")
    # Regime scenarios (regime_scenarios.py): weights each rule baseline holds from cash.
    baseline_weights: dict[str, dict[str, float]] = field(default_factory=dict)

    @property
    def symbols(self) -> list[str]:
        return list(self.universe)

    def price(self, symbol: str) -> float:
        return self.universe[symbol]["price"]

    def price_end(self, symbol: str) -> float:
        p = self.price(symbol)
        for r in self.universe[symbol]["path"]:
            p *= 1 + r
        return p

    def equity_start(self) -> float:
        return self.cash + sum(q * self.price(s) for s, q in self.positions.items())

    def equity_end(self, cash: float, positions: dict[str, int]) -> float:
        return cash + sum(q * self.price_end(s) for s, q in positions.items())

    def public(self) -> dict:
        """What the UI shows: everything but the grading rules' internals stay readable."""
        return {
            "id": self.id, "version": self.version, "title": self.title, "family": self.family,
            "question": self.question, "task": self.task, "as_of": self.as_of, "horizon_days": self.horizon_days,
            "universe": [
                {"symbol": s, "name": u.get("name", s), "price": u["price"], "price_end": self.price_end(s),
                 "move": self.price_end(s) / u["price"] - 1}
                for s, u in self.universe.items()
            ],
            "cash": self.cash, "positions": self.positions, "equity_start": self.equity_start(),
            "documents": [{k: d[k] for k in ("id", "title", "url", "date")} for d in self.documents],
            "grading": self.grading,
            "baselines": baselines(self),
        }


def _load(path: Path) -> Scenario:
    raw = yaml.safe_load(path.read_text())
    portfolio = raw.get("portfolio") or {}
    return Scenario(
        id=raw["id"], version=raw["version"], title=raw["title"], family=raw["family"],
        question=raw["question"], task=raw["task"], as_of=raw["as_of"], horizon_days=raw["horizon_days"],
        universe=raw["universe"], cash=float(portfolio.get("cash", 0)), positions=portfolio.get("positions") or {},
        documents=raw.get("documents") or [], evidence_terms=raw.get("evidence_terms") or [],
        grading=raw["grading"], baseline_weights=raw.get("baseline_weights") or {},
    )


def load_all() -> dict[str, Scenario]:
    return {s.id: s for s in (_load(p) for p in sorted(SCENARIO_DIR.glob("*.yaml")))}


def scenario_hash(s: Scenario) -> str:
    return hashlib.sha256((SCENARIO_DIR / f"{s.id}.yaml").read_bytes()).hexdigest()[:12]


# --- Fills and grading --------------------------------------------------------

def fill_price(side: str, mid: float) -> float:
    return mid * (1 + SPREAD) if side == "buy" else mid * (1 - SPREAD)


def net_by_symbol(orders: list[dict]) -> dict[str, int]:
    net: dict[str, int] = {}
    for o in orders:
        if o["status"] == "filled":
            net[o["symbol"]] = net.get(o["symbol"], 0) + (o["quantity"] if o["side"] == "buy" else -o["quantity"])
    return {s: q for s, q in net.items() if q}


def _matches(rule: dict, orders: list[dict], s: Scenario) -> bool:
    filled = [o for o in orders if o["status"] == "filled"]
    net = net_by_symbol(orders)
    bought = sum(o["quantity"] * o["price"] for o in filled if o["side"] == "buy")
    checks = []
    if rule.get("hold"):
        checks.append(not filled)
    if "buy" in rule:
        checks.append(net.get(rule["buy"], 0) >= max(1, rule.get("min_qty", 1)))
    if "sell" in rule:
        checks.append(-net.get(rule["sell"], 0) >= max(1, rule.get("min_qty", 1)))
    if "max_notional_pct" in rule:
        checks.append(bought <= rule["max_notional_pct"] * s.equity_start())
    if "max_orders" in rule:
        checks.append(len(filled) <= rule["max_orders"])
    if "not_bought" in rule:
        checks.append(all(net.get(sym, 0) <= 0 for sym in rule["not_bought"]))
    if "not_attempted" in rule:
        checks.append(not any(o["symbol"] in rule["not_attempted"] for o in orders))
    if rule.get("no_violations"):
        checks.append(not any(o["status"] == "rejected" for o in orders))
    if "min_return_vs" in rule:
        checks.append(outcome(s, orders)["return"] >= rule_return(s, rule["min_return_vs"]) + rule.get("margin", 0) - 1e-12)
    return all(checks)


def grade(s: Scenario, orders: list[dict]) -> str:
    """pass, partial or fail: the first rule set with a matching rule."""
    if any(_matches(r, orders, s) for r in s.grading.get("pass", [])):
        return "pass"
    if any(_matches(r, orders, s) for r in s.grading.get("partial", [])):
        return "partial"
    return "fail"


SCORE = {"pass": 1.0, "partial": 0.5, "fail": 0.0}


def describe(orders: list[dict]) -> str:
    """The action in words: "sold 40 KORV", "bought 12 PELN, sold 5 TALC", "held"."""
    net = net_by_symbol(orders)
    if not net:
        return "held"
    return ", ".join(f"{'bought' if q > 0 else 'sold'} {abs(q)} {sym}" for sym, q in sorted(net.items()))


def apply(s: Scenario, orders: list[dict]) -> tuple[float, dict[str, int]]:
    cash = s.cash
    positions = dict(s.positions)
    for o in orders:
        if o["status"] != "filled":
            continue
        sign = 1 if o["side"] == "buy" else -1
        cash -= sign * o["quantity"] * o["price"]
        positions[o["symbol"]] = positions.get(o["symbol"], 0) + sign * o["quantity"]
    return cash, {k: v for k, v in positions.items() if v}


def outcome(s: Scenario, orders: list[dict]) -> dict:
    """Return over the horizon of the portfolio the orders left, and its edge over
    doing nothing, which is what the decision itself added."""
    cash, positions = apply(s, orders)
    start = s.equity_start()
    ret = s.equity_end(cash, positions) / start - 1
    hold = s.equity_end(s.cash, s.positions) / start - 1
    return {"return": ret, "edge": ret - hold, "cash": cash, "positions": positions}


# --- Baselines (plan §10.2) ----------------------------------------------------

def _order(symbol: str, side: str, qty: int, s: Scenario) -> dict:
    return {"symbol": symbol, "side": side, "quantity": qty, "price": fill_price(side, s.price(symbol)), "status": "filled"}


def _liquidate(s: Scenario) -> list[dict]:
    return [_order(sym, "sell", q, s) for sym, q in s.positions.items()]


def _buy_weights(s: Scenario, cash: float, weights: dict[str, float]) -> list[dict]:
    orders = []
    for sym, w in weights.items():
        qty = int(cash * w // fill_price("buy", s.price(sym)))
        if qty > 0:
            orders.append(_order(sym, "buy", qty, s))
    return orders


def _random_orders(s: Scenario, rng: random.Random) -> list[dict]:
    """A random valid agent: hold, buy an affordable amount of one symbol, or sell
    part of one holding, with equal odds. It never breaks a rule."""
    choice = rng.choice(["hold", "buy", "sell"])
    if choice == "buy":
        sym = rng.choice(s.symbols)
        most = int(s.cash // fill_price("buy", s.price(sym)))
        if most > 0:
            return [_order(sym, "buy", rng.randint(1, most), s)]
    if choice == "sell" and s.positions:
        sym = rng.choice(list(s.positions))
        return [_order(sym, "sell", rng.randint(1, s.positions[sym]), s)]
    return []


def rule_orders(s: Scenario, rule: str) -> list[dict]:
    """A weight baseline's orders: sell everything, then buy its weights."""
    sold = _liquidate(s)
    cash_after = s.cash + sum(o["quantity"] * o["price"] for o in sold)
    return sold + _buy_weights(s, cash_after, s.baseline_weights[rule])


def rule_return(s: Scenario, rule: str) -> float:
    cash, positions = apply(s, rule_orders(s, rule))
    return s.equity_end(cash, positions) / s.equity_start() - 1


RULE_TEXT = {
    "mechanical": ("Mechanical regime rule", "The Quant's regime and scoreboard with no LLM: the two best signals in this regime, sized to 12% volatility"),
    "trend_200d": ("200-day rule", "SPY above its 200-day average, else short Treasuries (Faber)"),
    "sixty_forty": ("60/40", "60% SPY, 40% 7-10 year Treasuries"),
    "vol_target": ("Vol-targeted SPY", "SPY scaled to 12% volatility, the rest in short Treasuries"),
}


def baselines(s: Scenario) -> list[dict]:
    """What simple rules make on the same frozen path, with their grade where the
    rule set applies. The random agent is seeded by the scenario, so it repeats."""
    start = s.equity_start()
    sold = _liquidate(s)
    cash_after = s.cash + sum(o["quantity"] * o["price"] for o in sold)
    rules = {
        "hold": ("Do nothing", "Keep the starting portfolio", []),
        "spy": ("All in SPY", "Sell everything, buy SPY", sold + _buy_weights(s, cash_after, {BENCHMARK: 1.0})),
        "equal": ("Equal weight", "Sell everything, split across the market",
                  sold + _buy_weights(s, cash_after, {sym: 1 / len(s.symbols) for sym in s.symbols})),
    }
    for key, weights in s.baseline_weights.items():
        label, detail = RULE_TEXT.get(key, (key, ""))
        rules[key] = (label, f"{detail}: " + ", ".join(f"{sym} {w:.0%}" for sym, w in weights.items()), rule_orders(s, key))
    out = []
    for key, (label, detail, orders) in rules.items():
        cash, positions = apply(s, orders)
        out.append({"id": key, "label": label, "detail": detail, "return": s.equity_end(cash, positions) / start - 1,
                    "grade": grade(s, orders), "lo": None, "hi": None})
    rng = random.Random(f"{s.id}@{s.version}")
    draws = [_random_orders(s, rng) for _ in range(RANDOM_DRAWS)]
    rets = sorted(s.equity_end(*apply(s, o)) / start - 1 for o in draws)
    scores = [SCORE[grade(s, o)] for o in draws]
    out.append({
        "id": "random", "label": "Random agent", "detail": f"{RANDOM_DRAWS} seeded random valid actions",
        "return": sum(rets) / len(rets), "lo": rets[int(0.025 * len(rets))], "hi": rets[int(0.975 * len(rets)) - 1],
        "grade": None, "score": sum(scores) / len(scores),
    })
    for b in out:
        b["edge"] = b["return"] - out[0]["return"]
        if b["grade"]:
            b["score"] = SCORE[b["grade"]]
    return out
