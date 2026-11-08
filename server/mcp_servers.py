import os
from pathlib import Path
from dotenv import load_dotenv
from agents.mcp import MCPServerStdio, create_static_tool_filter
from .market import massive_api_key

load_dotenv(override=True)

PROJECT_DIR = str(Path(__file__).resolve().parent.parent)
tavily_env = {"TAVILY_API_KEY": os.getenv("TAVILY_API_KEY")}
TIMEOUT = 120

# The market data server for the trader.
# With a key, hand the agent Massive's own market data server, run locally over stdio.
# Without one, use our market server, which serves simulated prices.
if massive_api_key:
    market_params = {
        "command": "uvx",
        "args": [
            "--with", "mcp<2",
            "--from", "git+https://github.com/massive-com/mcp_massive@v0.10.0",
            "mcp_massive"
        ],
        "env": {"MASSIVE_API_KEY": massive_api_key},
    }
else:
    market_params = {
        "command": "uv",
        "args": ["run", "-m", "server.market_server"],
        "cwd": PROJECT_DIR
    }

# Traders whose playbooks are computed by the Quant, and those whose strategy is a fixed playbook (plan §4.4).
QUANT_TRADERS = {"Robin", "Jinbe", "Law"}
PLAYBOOK_TRADERS = {"Robin", "Jinbe", "Law", "Luffy"}
# Luffy, the day trader, gets the Day-Trade desk (the opening range breakout) instead of the Quant.
DAY_TRADERS = {"Luffy"}


def trader_mcp_servers(name: str, trace_id: str | None = None) -> list[MCPServerStdio]:
    """The trader's MCP servers: our Accounts server, Push Notification and Market data,
    the Quant for the traders whose playbooks use it, and the Day-Trade desk for the day trader.

    The Accounts and Quant servers are bound to this trader's account through their
    environment, so the agent cannot name another account (D4); the Accounts server
    also stamps each trade with the trace.
    """
    accounts_env = {"LAB_ACCOUNT": name, "LAB_TRACE_ID": trace_id or ""}
    params = [
        {"command": "uv", "args": ["run", "-m", "server.accounts_server"], "cwd": PROJECT_DIR, "env": accounts_env},
        {"command": "uv", "args": ["run", "-m", "server.push_server"], "cwd": PROJECT_DIR},
        market_params,
    ]
    if name in QUANT_TRADERS:
        params.append({"command": "uv", "args": ["run", "-m", "server.quant_server"], "cwd": PROJECT_DIR,
                       "env": {"QUANT_ACCOUNT": name}})
    if name in DAY_TRADERS:
        params.append({"command": "uv", "args": ["run", "-m", "server.day_trade_server"], "cwd": PROJECT_DIR,
                       "env": {"DAYTRADE_ACCOUNT": name}})
    servers = [MCPServerStdio(p, client_session_timeout_seconds=TIMEOUT) for p in params]
    if name in PLAYBOOK_TRADERS:
        # A playbook is fixed (plan §4.4): its trader gets no tool to rewrite it.
        servers[0] = MCPServerStdio(params[0], client_session_timeout_seconds=TIMEOUT,
                                    tool_filter=create_static_tool_filter(blocked_tool_names=["change_strategy"]))
    return servers


def web_mcp_servers() -> list[MCPServerStdio]:
    """Fetch and Tavily web search.

    Tavily's server offers several tools; we restrict it to web search so the
    researcher reaches for plain search rather than its heavier crawl or deep-research tools.
    """
    fetch = MCPServerStdio(
        {"command": "uvx", "args": ["--with", "mcp<2","mcp-server-fetch"]},
        client_session_timeout_seconds=TIMEOUT,
    )
    search = MCPServerStdio(
        {"command": "npx", "args": ["-y", "tavily-mcp@latest"], "env": tavily_env},
        client_session_timeout_seconds=TIMEOUT,
        tool_filter=create_static_tool_filter(allowed_tool_names=["tavily_search"]),
    )
    return [fetch, search]


def researcher_mcp_servers(name: str) -> list[MCPServerStdio]:
    """The researcher's MCP servers: Fetch, Tavily web search and Memory."""
    memory = MCPServerStdio(
        {
            "command": "npx",
            "args": ["-y", "mcp-memory-libsql"],
            "env": {"LIBSQL_URL": f"file:./memory/{name}.db"},
        },
        client_session_timeout_seconds=TIMEOUT,
    )
    return [*web_mcp_servers(), memory]
    
