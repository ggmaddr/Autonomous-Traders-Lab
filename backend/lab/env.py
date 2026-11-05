"""The environment one trial runs in: a sandbox account on the scenario's frozen
market, and the scenario's documents as the only research there is. The tools carry
the live tools' names (lookup_share_price, buy_shares, search, fetch...) but act on
this sandbox alone: no account name argument (D4), no price for a symbol outside the
market (D1), and every order attempt is recorded with why it filled or was refused.

They are in-process SDK function tools, so each call is an ordinary function span in
the saved trace.
"""

import json
import math
import re

from agents import function_tool

from .scenarios import Scenario, fill_price

WORD = re.compile(r"[a-z0-9$%.]+")


class Environment:
    def __init__(self, scenario: Scenario):
        self.s = scenario
        self.cash = scenario.cash
        self.positions = dict(scenario.positions)
        self.orders: list[dict] = []
        self.lookups: list[str] = []

    # --- Account -------------------------------------------------------------

    def account(self) -> dict:
        holdings = {sym: {"shares": q, "price": self.s.price(sym)} for sym, q in self.positions.items()}
        value = self.cash + sum(h["shares"] * h["price"] for h in holdings.values())
        return {"cash": round(self.cash, 2), "holdings": holdings, "portfolio_value": round(value, 2)}

    def order(self, side: str, symbol: str, quantity: int, rationale: str) -> str:
        symbol = (symbol or "").upper().strip()
        record = {"symbol": symbol, "side": side, "quantity": quantity, "rationale": rationale, "price": None,
                  "status": "rejected", "reason": None}
        self.orders.append(record)
        if symbol not in self.s.universe:
            record["reason"] = "unknown symbol"
            return f"Rejected: {symbol} is not traded in this market. Tradable symbols: {', '.join(self.s.symbols)}."
        if not isinstance(quantity, int) or quantity <= 0:
            record["reason"] = "invalid quantity"
            return "Rejected: quantity must be a whole number of shares above zero."
        price = fill_price(side, self.s.price(symbol))
        if side == "buy" and quantity * price > self.cash + 1e-9:
            record["reason"] = "insufficient cash"
            most = math.floor(self.cash / price)
            return f"Rejected: {quantity} {symbol} costs ${quantity * price:,.2f} but cash is ${self.cash:,.2f}; at most {most} shares."
        if side == "sell" and quantity > self.positions.get(symbol, 0):
            record["reason"] = "not enough shares"
            return f"Rejected: you hold {self.positions.get(symbol, 0)} {symbol}."
        sign = 1 if side == "buy" else -1
        self.cash -= sign * quantity * price
        self.positions[symbol] = self.positions.get(symbol, 0) + sign * quantity
        if not self.positions[symbol]:
            del self.positions[symbol]
        record.update(status="filled", price=price, reason=None)
        verb = "Bought" if side == "buy" else "Sold"
        return f"{verb} {quantity} {symbol} at ${price:.2f}. Account now: {json.dumps(self.account())}"

    def trade_tools(self) -> list:
        env = self

        @function_tool
        def lookup_share_price(symbol: str) -> str:
            """Look up the current share price of a symbol.

            Args:
                symbol: the ticker, for example SPY
            """
            sym = symbol.upper().strip()
            env.lookups.append(sym)
            if sym not in env.s.universe:
                return f"Unknown symbol {sym}: not traded in this market. Tradable symbols: {', '.join(env.s.symbols)}."
            return f"{sym} ({env.s.universe[sym].get('name', sym)}): ${env.s.price(sym):.2f} as of {env.s.as_of}"

        @function_tool
        def get_balance() -> str:
            """Your cash balance."""
            return f"Cash: ${env.cash:,.2f}"

        @function_tool
        def get_holdings() -> str:
            """Your holdings, with each one's current price."""
            return json.dumps(env.account()["holdings"])

        @function_tool
        def buy_shares(symbol: str, quantity: int, rationale: str) -> str:
            """Buy shares of a stock in your account.

            Args:
                symbol: the ticker to buy
                quantity: whole number of shares
                rationale: why, in a sentence
            """
            return env.order("buy", symbol, quantity, rationale)

        @function_tool
        def sell_shares(symbol: str, quantity: int, rationale: str) -> str:
            """Sell shares of a stock you hold.

            Args:
                symbol: the ticker to sell
                quantity: whole number of shares
                rationale: why, in a sentence
            """
            return env.order("sell", symbol, quantity, rationale)

        return [lookup_share_price, get_balance, get_holdings, buy_shares, sell_shares]

    # --- Frozen research ---------------------------------------------------------

    def search(self, query: str, top: int = 3) -> list[dict]:
        """Rank the scenario's documents by the query words they contain, rarer words
        counting more. A plain keyword index: the research is frozen, the agent's
        questions are not."""
        terms = set(WORD.findall(query.lower()))
        docs = [(d, set(WORD.findall(f"{d['title']} {d['text']}".lower()))) for d in self.s.documents]
        def idf(t: str) -> float:
            return math.log(1 + len(docs) / (1 + sum(t in words for _, words in docs)))
        scored = [(sum(idf(t) for t in terms & words), d) for d, words in docs]
        return [d for score, d in sorted(scored, key=lambda x: -x[0]) if score > 0][:top]

    def research_tools(self) -> list:
        env = self

        @function_tool
        def search(query: str) -> str:
            """Search the news for a query. Returns titles, links and the text of the best matches.

            Args:
                query: what to search for
            """
            hits = env.search(query)
            if not hits:
                return "No results."
            return "\n\n".join(f"Title: {d['title']}\nURL: {d['url']}\nDate: {d['date']}\nContent: {d['text']}" for d in hits)

        @function_tool
        def fetch(url: str) -> str:
            """Fetch a web page by its URL.

            Args:
                url: the page to fetch
            """
            doc = next((d for d in env.s.documents if d["url"] == url.strip()), None)
            return f"{doc['title']}\n{doc['date']}\n\n{doc['text']}" if doc else f"Could not fetch {url}: not found."

        return [search, fetch]

    def digest(self) -> str:
        return "\n\n".join(f"{d['date']} · {d['title']}\n{d['text']}" for d in self.s.documents)

    def result(self) -> dict:
        return {"orders": self.orders, "lookups": self.lookups, "cash": self.cash, "positions": self.positions}
