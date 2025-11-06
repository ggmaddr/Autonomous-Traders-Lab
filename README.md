# AutoTrade - AI-Powered Trading Simulation Platform

AutoTrade is an automated stock trading simulation platform that uses AI agents to manage trading portfolios. The system features multiple AI-powered traders that research market opportunities, make trading decisions, and execute trades based on their individual strategies.

## Features

- **Multiple AI Traders**: Four different AI traders (Warren, George, Ray, and Cathie) each with unique trading strategies
- **Real-time Market Data**: Integration with Polygon.io for market data (supports free, paid, and real-time tiers)
- **AI Research Agents**: Each trader has access to a researcher agent that can search the web, analyze market conditions, and identify opportunities
- **MCP (Model Context Protocol) Integration**: Uses MCP servers for accounts management, market data, push notifications, and research tools
- **Web Dashboard**: Beautiful Gradio-based web interface to monitor trader performance, portfolio values, holdings, and transactions
- **Multiple AI Models**: Support for OpenAI, DeepSeek, Grok, Gemini, and OpenRouter models
- **Persistent Memory**: Traders use knowledge graphs to store and recall information about companies and market conditions

## Project Structure

```
autotrade/
├── app.py                 # Main Gradio web interface
├── traders.py             # Trader agent implementation
├── trading_floor.py       # Trading scheduler and trader management
├── accounts.py            # Account management and trading operations
├── market.py              # Market data integration (Polygon.io)
├── database.py            # SQLite database for accounts and logs
├── accounts_server.py     # MCP server for account operations
├── market_server.py       # MCP server for market data
├── push_server.py         # MCP server for push notifications
├── accounts_client.py     # MCP client for account operations
├── mcp_params.py          # MCP server configuration
├── templates.py           # AI agent instructions and prompts
├── tracers.py             # Logging and tracing utilities
├── util.py                # UI utilities (CSS, JS)
├── memory/                # SQLite databases for trader memory
└── requirements.txt       # Python dependencies
```

## Prerequisites

- Python 3.9 or higher
- `uv` package manager (for running MCP servers) - [Install uv](https://github.com/astral-sh/uv)
- Node.js and npm (for MCP servers that use npx)
- API keys for:
  - At least one AI model provider (OpenAI, DeepSeek, Grok, Google/Gemini, or OpenRouter)
  - Polygon.io (for market data)
  - Optional: Pushover (for notifications)
  - Optional: Brave Search API (for enhanced research)

## Setup Instructions

### 1. Clone the Repository

```bash
git clone <repository-url>
cd autotrade
```

### 2. Install Python Dependencies

```bash
pip install -r requirements.txt
```

**Note**: There may be a version conflict warning between `gradio` (requires pydantic<2.12) and `openai-agents` (requires pydantic>=2.12.3). The project works with pydantic 2.12.4 despite the warning.

### 3. Install Additional Tools

The project uses `uv` for running Python scripts as MCP servers. Install it if you haven't already:

```bash
# macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Or via pip
pip install uv
```

### 4. Create Environment File

Create a `.env` file in the project root with your API keys:

```bash
# Required: At least one AI model API key
OPENROUTER_API_KEY=your_openrouter_api_key_here
# OR
DEEPSEEK_API_KEY=your_deepseek_api_key_here
# OR
GOOGLE_API_KEY=your_google_api_key_here
# OR
GROK_API_KEY=your_grok_api_key_here

# Required: Polygon.io API key for market data
POLYGON_API_KEY=your_polygon_api_key_here
POLYGON_PLAN=free  # Options: free, paid, realtime

# Optional: Pushover for notifications
PUSHOVER_USER=your_pushover_user_key_here
PUSHOVER_TOKEN=your_pushover_token_here

# Optional: Brave Search API for researcher agent
BRAVE_API_KEY=your_brave_api_key_here

# Optional: Trading configuration
RUN_EVERY_N_MINUTES=60
RUN_EVEN_WHEN_MARKET_IS_CLOSED=false
USE_MANY_MODELS=false
```

### 5. Get API Keys

- **OpenRouter**: https://openrouter.ai/ (supports multiple AI models)
- **DeepSeek**: https://platform.deepseek.com/
- **Google/Gemini**: https://makersuite.google.com/app/apikey
- **Grok**: https://x.ai/
- **Polygon.io**: https://polygon.io/ (free tier available)
- **Pushover**: https://pushover.net/ (optional)
- **Brave Search**: https://brave.com/search/api/ (optional)

## Running the Project

### Start the Web Dashboard

```bash
python app.py
```

This will start the Gradio web interface. The dashboard will open in your browser automatically, showing:
- Portfolio values for each trader
- Real-time charts of portfolio performance
- Current holdings
- Recent transactions
- Activity logs

### Start the Trading Agents

In a separate terminal, start the trading scheduler:

```bash
python trading_floor.py
```

This will run the trading agents on a schedule (default: every 60 minutes). The agents will:
1. Research market opportunities
2. Analyze their portfolios
3. Execute trades based on their strategies
4. Send push notifications (if configured)

## Configuration

### Trading Schedule

Set `RUN_EVERY_N_MINUTES` in your `.env` file to control how often traders execute trades.

### Market Hours

By default, traders only run when the market is open. Set `RUN_EVEN_WHEN_MARKET_IS_CLOSED=true` to run 24/7.

### Multiple AI Models

Set `USE_MANY_MODELS=true` to use different AI models for each trader:
- Warren: GPT 4.1 Mini
- George: DeepSeek V3
- Ray: Gemini 2.5 Flash
- Cathie: Grok 3 Mini

### Market Data Tiers

- **Free**: End-of-day data (previous day's close)
- **Paid**: 15-minute delayed data
- **Realtime**: Real-time market data

Set `POLYGON_PLAN` in your `.env` file accordingly.

## How It Works

1. **Traders**: Each trader is an AI agent with a unique strategy and personality
2. **Researcher**: Each trader has access to a researcher agent that can:
   - Search the web for financial news
   - Analyze market conditions
   - Identify trading opportunities
   - Store information in a knowledge graph
3. **MCP Servers**: The system uses MCP (Model Context Protocol) servers for:
   - Account management (buy/sell stocks, check balance)
   - Market data (get stock prices)
   - Push notifications (send alerts)
   - Web research (fetch pages, search)
   - Memory (persistent knowledge storage)
4. **Database**: SQLite database stores:
   - Account information (balance, holdings, transactions)
   - Market data (cached prices)
   - Activity logs

## Troubleshooting

### Import Errors

If you see `ModuleNotFoundError: No module named 'agents'`, make sure you've installed all dependencies:

```bash
pip install -r requirements.txt
```

The `agents` package is provided by `openai-agents`.

### API Key Errors

If you see errors about missing API keys, ensure your `.env` file is in the project root and contains the required keys.

### MCP Server Errors

If MCP servers fail to start, ensure:
- `uv` is installed and in your PATH
- Node.js and npm are installed (for npx-based servers)
- The `memory/` directory exists (it will be created automatically)

### Database Errors

The SQLite database (`accounts.db`) will be created automatically on first run. Ensure the project directory is writable.

## License

See LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

