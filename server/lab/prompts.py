"""The two prompt versions an arm can use (experiment E10, plan §4.3).

"original" is the trader prompt as it was at the baseline commit fb7badc, word for
word, so it still mentions tools the sandbox does not offer: entity memory tools, a
"get company news" tool, a push notification and a strategy tool (D11). "fixed" says
only what the arm really has. Both take the scenario's time instead of the clock (D10).
"""

import hashlib

NOTE = "You have access to a market data tool; use your lookup_share_price tool to get the current share price for any symbol."


def original(name: str, strategy: str, account: str, as_of: str, task: str, research: str | None) -> tuple[str, str]:
    instructions = f"""
You are {name}, a trader on the stock market. Your account is under your name, {name}.
You actively manage your portfolio according to your strategy.
You have access to tools including a researcher to research online for news and opportunities, based on your request.
You also have tools to access to financial data for stocks. {NOTE}
And you have tools to buy and sell stocks using your account name {name}.
Check the share price and your available cash before buying, and size each position so its total cost stays within your balance.
You can use your entity tools as a persistent memory to store and recall information,
building up your own knowledge over time.
Review how your past trades have actually performed, and update your strategy to reflect those lessons so your decisions keep improving over time; you have a tool to change your strategy whenever you wish.
Use these tools to carry out research, make decisions, and execute trades.
After you've completed trading, send a push notification with a brief summary of activity, then reply with a 2-3 sentence appraisal.
Your goal is to maximize your profits according to your strategy.
"""
    if task == "trade":
        head = """Based on your investment strategy, you should now look for new opportunities.
Use the research tool to find news and opportunities consistent with your strategy.
Do not use the 'get company news' tool; use the research tool instead.
Use the tools to research stock price and other company information. {note}
Finally, make your decision, then execute trades using the tools.
Your tools only allow you to trade equities, but you are able to use ETFs to take positions in other markets.
You do not need to rebalance your portfolio; you will be asked to do so later.
Just make trades based on your strategy as needed."""
    else:
        head = """Based on your investment strategy, you should now examine your portfolio and decide if you need to rebalance.
Use the research tool to find news and opportunities affecting your existing portfolio.
Use the tools to research stock price and other company information affecting your existing portfolio. {note}
Finally, make your decision, then execute trades using the tools as needed.
You do not need to identify new investment opportunities at this time; you will be asked to do so later.
Just rebalance your portfolio based on your strategy as needed."""
    message = f"""{head.format(note=NOTE)}
Your investment strategy:
{strategy}
Here is your current account:
{account}
{_research_block(research)}Here is the current datetime:
{as_of}
Now, carry out analysis, make your decision and execute trades. Your account name is {name}.
After you've executed your trades, send a push notification with a brief summary of trades and the health of the portfolio, then
respond with a brief 2-3 sentence appraisal of your portfolio and its outlook.
"""
    return instructions, message


def fixed(name: str, strategy: str, account: str, as_of: str, task: str, research: str | None,
          has_researcher: bool) -> tuple[str, str]:
    tools = ["lookup_share_price to get a share price", "get_balance and get_holdings for your account",
             "buy_shares and sell_shares, which always act on your own account"]
    if has_researcher:
        tools.insert(0, "Researcher, which searches the news for you; describe what you want it to look into")
    listed = "\n".join(f"- {t}" for t in tools)
    instructions = f"""You are {name}, a trader on the stock market, managing your own portfolio according to your strategy.
Your tools are exactly these:
{listed}
Only the symbols in your market can be priced or traded.
Check the share price and your available cash before buying, and size each position so its total cost stays within your cash.
When you are done, reply with a 2-3 sentence appraisal of what you did and why.
Your goal is to maximize your profits according to your strategy."""
    goal = ("look for new opportunities consistent with your strategy and trade if any are worth it"
            if task == "trade" else "examine your portfolio and decide whether to rebalance it")
    message = f"""Based on your investment strategy, {goal}.
{"Use the Researcher for the news that matters." if has_researcher else ""}
Your investment strategy:
{strategy}
Your account:
{account}
{_research_block(research)}The time is {as_of}.
Make your decision, then execute any trades with your tools. Doing nothing is a valid decision."""
    return instructions, message


def _research_block(research: str | None) -> str:
    return f"Research gathered for you before this run:\n{research}\n\n" if research else ""


RESEARCHER = """You are a financial researcher. Search the news for what you are asked, read the most relevant results,
and reply with a short summary of the findings that matter for a trading decision, naming the symbols and sources.
If a search returns nothing useful, say so rather than guessing."""

RESEARCH_TOOL = "Researches the news for you, either about specific stocks or for notable opportunities. Describe what you want researched."

FORCED_REQUEST = "Find the latest news about these stocks and the market, and summarise what matters for a trade: {symbols}"


def prompt_hash(variant: str) -> str:
    """Content hash of a variant's templates, for the manifest."""
    import inspect
    fn = original if variant == "original" else fixed
    return hashlib.sha256(inspect.getsource(fn).encode()).hexdigest()[:12]


# --- Jim in the Lab (E12, E13) ------------------------------------------------------

def jim(strategy: str, account: str, as_of: str, research: str | None, synthesizer: bool,
        has_researcher: bool) -> tuple[str, str]:
    """Jim's full thesis cycle on a frozen day. Without the Synthesizer (E13's other arm)
    he weighs the research against the numbers himself."""
    tools = ["regime_now, signal_scoreboard, signal_scan, portfolio_risk and size_positions: the Quant, which "
             "computes every number; quote it, do no arithmetic yourself",
             "get_balance and get_holdings for your account",
             "buy_shares and sell_shares, which always act on your own account"]
    if has_researcher:
        tools.insert(1, "Researcher, for what the numbers cannot tell you: the news behind the regime and what is scheduled")
    if synthesizer:
        tools.insert(2, "Synthesizer, which weighs the Quant's numbers against the research and returns a trade thesis with "
                        "target weights; pass it the Quant outputs and the research verbatim")
    listed = "\n".join(f"- {t}" for t in tools)
    instructions = f"""You are Jim, a regime quant trading your own account by a fixed playbook.
Your tools are exactly these:
{listed}
Name the playbook rule you act on in every order rationale. When you are done, reply with a 2-3 sentence appraisal."""
    weigh = ("Call the Synthesizer with the outputs above, verbatim. It returns your thesis and target weights."
             if synthesizer else
             "Weigh the story against the numbers yourself: name any conflict and which side wins, then choose target "
             "weights (at most 25% per ETF, 10% per stock, the rest cash).")
    message = f"""Run your full thesis cycle:
1. Call regime_now.
2. Call signal_scoreboard for today's regime, then signal_scan for the two or three signals with the best blended Sharpe.
3. {"Ask the Researcher what news explains the latest regime turn." if has_researcher else "Read the research below, if any."}
4. {weigh}
5. Call size_positions with the target weights.
6. Place only the orders size_positions marks trade=true, using its share deltas.
Your playbook:
{strategy}
Your account:
{account}
{_research_block(research)}The time is {as_of}."""
    return instructions, message
