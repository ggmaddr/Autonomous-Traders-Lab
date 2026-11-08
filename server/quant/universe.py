"""The symbols the Market Year pipeline loads, and the groups the features and signals
use. The 20 large caps are today's largest S&P 500 names, not a point-in-time list, so
the scoreboard's stock signals carry survivorship bias; the UI says so (§4.4.4).
"""

INDICES = ["SPY", "QQQ", "IWM", "EFA", "EEM"]
SECTORS = ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"]
RATES = ["TLT", "IEF", "SHY", "TIP"]
CREDIT = ["HYG", "LQD"]
MACRO = ["UUP", "GLD", "USO", "CPER", "VIXY", "SH"]
LARGE_CAPS = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "AVGO", "TSLA", "BRK.B", "JPM",
    "LLY", "V", "XOM", "UNH", "MA", "COST", "WMT", "HD", "PG", "JNJ",
]
# Warren's screen universe (§4.4.1): large S&P 500 companies outside financials and
# REITs, whose accounts break these screens. Today's names, not a point-in-time list.
QUALITY = [
    "AAPL", "MSFT", "GOOGL", "META", "NVDA", "AVGO", "ADBE", "CRM", "ORCL", "CSCO", "TXN", "QCOM", "INTU", "ACN", "IBM",
    "COST", "WMT", "PG", "KO", "PEP", "MCD", "NKE", "SBUX", "HD", "LOW", "TJX", "AMZN", "TSLA",
    "JNJ", "LLY", "UNH", "ABBV", "MRK", "PFE", "TMO", "ABT", "AMGN",
    "HON", "CAT", "DE", "UNP", "UPS", "LMT", "GD", "MMM", "XOM", "CVX", "LIN", "CMCSA", "VZ",
]
SYMBOLS = list(dict.fromkeys(INDICES + SECTORS + RATES + CREDIT + MACRO + LARGE_CAPS + QUALITY))

# George's universe (§4.4.2): equity indices, sectors, rates, credit, the dollar, gold
# and oil, long only; SH only as a short-lived hedge.
MACRO_UNIVERSE = INDICES + SECTORS + ["TLT", "IEF", "SHY", "HYG", "LQD", "UUP", "GLD", "USO", "SH"]

SECTOR_NAMES = {
    "XLB": "Materials", "XLC": "Communication", "XLE": "Energy", "XLF": "Financials",
    "XLI": "Industrials", "XLK": "Technology", "XLP": "Staples", "XLRE": "Real estate",
    "XLU": "Utilities", "XLV": "Health care", "XLY": "Discretionary",
}

# What a long-only book holds when it is defensive (§4.4.4 Long-only). Anything else
# that is not cash counts as risk-on.
DEFENSIVE = {"XLU", "XLP", "XLV", "TLT", "IEF", "SHY", "TIP", "LQD", "GLD", "SH", "BND", "AGG", "BIL", "SGOV"}

BENCHMARK = "SPY"
PRIOR_START = "2016-01-01"  # the ten-year prior starts here; the year scored is the as-of year
