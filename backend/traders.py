from contextlib import AsyncExitStack
from datetime import datetime, timezone
from .accounts_client import read_accounts_resource, read_strategy_resource
from .tracers import make_trace_id
from .database import start_run, end_run
from agents import Agent, Tool, Runner, trace
from dotenv import load_dotenv
import json
from local_llm import local_model, MODEL_NAME
from .templates import (
    researcher_instructions,
    trader_instructions,
    trade_message,
    rebalance_message,
    research_tool,
)
from .mcp_servers import trader_mcp_servers, researcher_mcp_servers

load_dotenv(override=True)

MAX_TURNS = 30


def get_model(model_name: str):
    # Every trader and researcher runs on the local Ollama model, whatever name it is given.
    return local_model


async def get_researcher(mcp_servers, model_name) -> Agent:
    researcher = Agent(
        name="Researcher",
        instructions=researcher_instructions(),
        model=get_model(model_name),
        mcp_servers=mcp_servers,
    )
    return researcher


async def get_researcher_tool(mcp_servers, model_name) -> Tool:
    researcher = await get_researcher(mcp_servers, model_name)
    return researcher.as_tool(tool_name="Researcher", tool_description=research_tool())


class Trader:
    def __init__(self, name: str, lastname="Trader", model_name=MODEL_NAME):
        self.name = name
        self.lastname = lastname
        self.agent = None
        self.model_name = model_name
        self.do_trade = True
        self.trace_id = None
        self.cycle_id = None

    async def create_agent(self, trader_mcp_servers, researcher_mcp_servers) -> Agent:
        tool = await get_researcher_tool(researcher_mcp_servers, self.model_name)
        self.agent = Agent(
            name=self.name,
            instructions=trader_instructions(self.name),
            model=get_model(self.model_name),
            tools=[tool],
            mcp_servers=trader_mcp_servers,
        )
        return self.agent

    async def get_account_report(self) -> str:
        account = await read_accounts_resource(self.name)
        account_json = json.loads(account)
        account_json.pop("portfolio_value_time_series", None)
        return json.dumps(account_json)

    async def run_agent(self, trader_mcp_servers, researcher_mcp_servers):
        self.agent = await self.create_agent(trader_mcp_servers, researcher_mcp_servers)
        account = await self.get_account_report()
        strategy = await read_strategy_resource(self.name)
        start_run(self.trace_id, self.cycle_id, self.name, self.mode, strategy, account, _now())
        message = (
            trade_message(self.name, strategy, account)
            if self.do_trade
            else rebalance_message(self.name, strategy, account)
        )
        result = await Runner.run(self.agent, message, max_turns=MAX_TURNS)
        return str(result.final_output)

    async def run_with_mcp_servers(self):
        async with AsyncExitStack() as stack:
            trader_servers = [
                await stack.enter_async_context(server)
                for server in trader_mcp_servers(self.name, self.trace_id)
            ]
            researcher_servers = [
                await stack.enter_async_context(server)
                for server in researcher_mcp_servers(self.name)
            ]
            return await self.run_agent(trader_servers, researcher_servers)

    @property
    def mode(self) -> str:
        return "trade" if self.do_trade else "rebalance"

    async def run_with_trace(self):
        trace_name = f"{self.name}-trading" if self.do_trade else f"{self.name}-rebalancing"
        metadata = {"trader": self.name, "mode": self.mode, "cycle_id": self.cycle_id, "model": self.model_name}
        # group_id puts the four traders of one cycle together in the OpenAI trace viewer.
        with trace(trace_name, trace_id=self.trace_id, group_id=self.cycle_id, metadata=metadata):
            return await self.run_with_mcp_servers()

    async def run(self, cycle_id: str | None = None):
        self.cycle_id = cycle_id
        self.trace_id = make_trace_id(f"{self.name.lower()}")
        output, error = None, None
        try:
            output = await self.run_with_trace()
        except Exception as e:
            error = f"{type(e).__name__}: {e}"
            print(f"Error running trader {self.name}: {e}")
        try:
            after = await self.get_account_report()
        except Exception:
            after = None
        end_run(self.trace_id, after, output, error, _now())
        self.do_trade = not self.do_trade


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
