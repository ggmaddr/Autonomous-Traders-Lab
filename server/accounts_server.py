import os
from mcp.server.fastmcp import FastMCP
from .accounts import Account
from .playbooks import PLAYBOOKS

mcp = FastMCP("accounts_server")

# The trader this server instance acts for, and the trace of the run that spawned it.
# Both come from the environment (server/mcp_servers.py), never from the model.
ACCOUNT = os.getenv("LAB_ACCOUNT")
TRACE_ID = os.getenv("LAB_TRACE_ID") or None


def account() -> Account:
    if not ACCOUNT:
        raise ValueError("This accounts server is not bound to an account (LAB_ACCOUNT is not set).")
    return Account.get(ACCOUNT)


@mcp.tool()
async def get_balance() -> float:
    """Get the cash balance of your account."""
    return account().balance

@mcp.tool()
async def get_holdings() -> dict[str, int]:
    """Get the holdings of your account."""
    return account().holdings

@mcp.tool()
async def buy_shares(symbol: str, quantity: int, rationale: str) -> str:
    """Buy shares of a stock.

    Args:
        symbol: The symbol of the stock
        quantity: The quantity of shares to buy
        rationale: The rationale for the purchase and fit with the account's strategy
    """
    return account().buy_shares(symbol, quantity, rationale, trace_id=TRACE_ID)


@mcp.tool()
async def sell_shares(symbol: str, quantity: int, rationale: str) -> str:
    """Sell shares of a stock.

    Args:
        symbol: The symbol of the stock
        quantity: The quantity of shares to sell
        rationale: The rationale for the sale and fit with the account's strategy
    """
    return account().sell_shares(symbol, quantity, rationale, trace_id=TRACE_ID)

@mcp.tool()
async def change_strategy(strategy: str) -> str:
    """At your discretion, if you choose to, call this to change your investment strategy for the future.

    Args:
        strategy: The new strategy for the account
    """
    if ACCOUNT and ACCOUNT.capitalize() in PLAYBOOKS:
        return "Your strategy is a fixed playbook and cannot be changed."
    return account().change_strategy(strategy)

@mcp.resource("accounts://accounts_server/{name}")
async def read_account_resource(name: str) -> str:
    account = Account.get(name.lower())
    return account.report()

@mcp.resource("accounts://strategy/{name}")
async def read_strategy_resource(name: str) -> str:
    account = Account.get(name.lower())
    return account.get_strategy()

if __name__ == "__main__":
    mcp.run(transport='stdio')
