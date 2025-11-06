Autotrade — Personal Original Fork

Overview
This repository is my original adaptation of an educational trading simulation. I rewrote UI structure, naming, and presentation, and reorganized modules to reflect my own approach while retaining the learning goals. Any third‑party services (e.g., market data APIs) are used via their public SDKs and documented below.

What’s Original
- Renamed and restructured the UI in `app.py` (now uses PortfolioSection/PortfolioSectionView, revised layout, labels, and theme).
- Documentation, configuration guidance, and run scripts.
- Project conventions, naming, and stylistic choices across modules as I continue refactoring.

Attribution and Inspiration
This work was inspired by classroom materials exploring LLM agents and trading simulations. I reimplemented structure and presentation to form an original project. Market data uses Polygon.io’s Python SDK when available.

Getting Started
1) Python 3.10+
2) Install dependencies:
   pip install -r requirements.txt
3) (Optional) Environment variables for market data:
   - POLYGON_API_KEY
   - POLYGON_PLAN: paid|realtime|free
4) Launch the app:
   python app.py

Project Structure
- `app.py`: Gradio dashboard (originalized layout and components).
- `market.py`: Market data adapter (to be further refactored for originality).
- `accounts.py`, `accounts_server.py`, `accounts_client.py`: Accounts and persistence.
- `traders.py`: Agent runner (to be further refactored for originality).
- `database.py`: Simple storage utilities.

License
See LICENSE. If you use or adapt this project, please include appropriate attribution and clearly document your own changes.



