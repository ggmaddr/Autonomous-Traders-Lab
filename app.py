import gradio as gr
from util import css, js, Color
import pandas as pd
from trading_floor import names, lastnames, short_model_names
import plotly.express as px
from accounts import Account
from database import read_log

mapper = {
    "trace": Color.WHITE,
    "agent": Color.CYAN,
    "function": Color.GREEN,
    "generation": Color.YELLOW,
    "response": Color.MAGENTA,
    "account": Color.RED,
}


class PortfolioSection:
    def __init__(self, name: str, lastname: str, model_name: str):
        self.name = name
        self.lastname = lastname
        self.model_name = model_name
        self.account = Account.get(name)

    def reload(self):
        self.account = Account.get(self.name)

    def get_title(self) -> str:
        return (
            f"<div style='text-align: center;font-size:30px;font-weight:600;'>"
            f"{self.name}"
            f"<span style='color:#6b7280;font-size:18px;'> — {self.lastname} | {self.model_name}</span>"
            f"</div>"
        )

    def get_strategy(self) -> str:
        return self.account.get_strategy()

    def get_portfolio_value_df(self) -> pd.DataFrame:
        df = pd.DataFrame(self.account.portfolio_value_time_series, columns=["datetime", "value"])
        df["datetime"] = pd.to_datetime(df["datetime"])
        return df

    def get_portfolio_value_chart(self):
        df = self.get_portfolio_value_df()
        fig = px.line(df, x="datetime", y="value")
        margin = dict(l=32, r=16, t=16, b=36)
        fig.update_layout(
            height=280,
            margin=margin,
            xaxis_title=None,
            yaxis_title=None,
            paper_bgcolor="#f3f4f6",
            plot_bgcolor="#eef2ff",
        )
        fig.update_xaxes(tickformat="%m/%d", tickangle=45, tickfont=dict(size=8))
        fig.update_yaxes(tickfont=dict(size=8), tickformat=",.0f")
        return fig

    def get_holdings_df(self) -> pd.DataFrame:
        """Convert holdings to DataFrame for display"""
        holdings = self.account.get_holdings()
        if not holdings:
            return pd.DataFrame(columns=["Symbol", "Quantity"])

        df = pd.DataFrame(
            [{"Symbol": symbol, "Quantity": quantity} for symbol, quantity in holdings.items()]
        )
        return df

    def get_transactions_df(self) -> pd.DataFrame:
        """Convert transactions to DataFrame for display"""
        transactions = self.account.list_transactions()
        if not transactions:
            return pd.DataFrame(columns=["Timestamp", "Symbol", "Quantity", "Price", "Rationale"])

        return pd.DataFrame(transactions)

    def get_portfolio_value(self) -> str:
        """Calculate total portfolio value based on current prices"""
        portfolio_value = self.account.calculate_portfolio_value() or 0.0
        pnl = self.account.calculate_profit_loss(portfolio_value) or 0.0
        color = "#065f46" if pnl >= 0 else "#7f1d1d"
        badge = "▲" if pnl >= 0 else "▼"
        return (
            f"<div style='text-align:center;padding:8px 0;'>"
            f"<span style='font-size:30px;font-weight:700;color:#111827'>${portfolio_value:,.0f}</span>"
            f"<span style='font-size:18px;color:{color};padding-left:12px'>{badge} ${pnl:,.0f}</span>"
            f"</div>"
        )

    def get_logs(self, previous=None) -> str:
        logs = read_log(self.name, last_n=13)
        response = ""
        for log in logs:
            timestamp, type, message = log
            color = mapper.get(type, Color.WHITE).value
            response += f"<span style='color:{color}'>{timestamp} : [{type}] {message}</span><br/>"
        response = f"<div style='height:250px; overflow-y:auto;'>{response}</div>"
        if response != previous:
            return response
        return gr.update()


class PortfolioSectionView:
    def __init__(self, section: PortfolioSection):
        self.section = section
        self.portfolio_value = None
        self.chart = None
        self.holdings_table = None
        self.transactions_table = None

    def make_ui(self):
        with gr.Column():
            gr.HTML(self.section.get_title())
            with gr.Row():
                self.portfolio_value = gr.HTML(self.section.get_portfolio_value)
            with gr.Row():
                self.chart = gr.Plot(
                    self.section.get_portfolio_value_chart, container=True, show_label=False
                )
            with gr.Row(variant="panel"):
                self.log = gr.HTML(self.section.get_logs)
            with gr.Row():
                self.holdings_table = gr.Dataframe(
                    value=self.section.get_holdings_df,
                    label="Open Positions",
                    headers=["Symbol", "Quantity"],
                    row_count=(5, "dynamic"),
                    col_count=2,
                    max_height=300,
                    elem_classes=["dataframe-fix-small"],
                )
            with gr.Row():
                self.transactions_table = gr.Dataframe(
                    value=self.section.get_transactions_df,
                    label="Latest Fills",
                    headers=["Timestamp", "Symbol", "Quantity", "Price", "Rationale"],
                    row_count=(5, "dynamic"),
                    col_count=5,
                    max_height=300,
                    elem_classes=["dataframe-fix"],
                )

        timer = gr.Timer(value=120)
        timer.tick(
            fn=self.refresh,
            inputs=[],
            outputs=[
                self.portfolio_value,
                self.chart,
                self.holdings_table,
                self.transactions_table,
            ],
            show_progress="hidden",
            queue=False,
        )
        log_timer = gr.Timer(value=0.5)
        log_timer.tick(
            fn=self.section.get_logs,
            inputs=[self.log],
            outputs=[self.log],
            show_progress="hidden",
            queue=False,
        )

    def refresh(self):
        self.section.reload()
        return (
            self.section.get_portfolio_value(),
            self.section.get_portfolio_value_chart(),
            self.section.get_holdings_df(),
            self.section.get_transactions_df(),
        )


# Main UI construction
def create_ui():
    """Create the main Gradio UI for the trading simulation"""

    sections = [
        PortfolioSection(trader_name, lastname, model_name)
        for trader_name, lastname, model_name in zip(names, lastnames, short_model_names)
    ]
    section_views = [PortfolioSectionView(section) for section in sections]

    with gr.Blocks(
        title="Autotrade Dashboard",
        css=css,
        js=js,
        theme=gr.themes.Default(primary_hue="indigo"),
        fill_width=True,
    ) as ui:
        with gr.Row():
            for section_view in section_views:
                section_view.make_ui()

    return ui


if __name__ == "__main__":
    ui = create_ui()
    ui.launch(inbrowser=True)
