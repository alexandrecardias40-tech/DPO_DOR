from __future__ import annotations

import os
from typing import Dict, List, Optional, Tuple

import pandas as pd
from dash import Dash, Input, Output, State, ctx, dash_table, dcc, html
from dash.exceptions import PreventUpdate

from .data_processing import load_datasets, refresh_global_datasets, save_uploaded_excel


def _normalize_base_path(env_var: str, default: str = "/") -> str:
    path = os.getenv(env_var, default).strip() or default
    if not path.startswith("/"):
        path = f"/{path}"
    if not path.endswith("/"):
        path = f"{path}/"
    return path


LOA_BASE_PATH = _normalize_base_path("LOA_DASH_BASEPATH")

PRIMARY_COLOR = "#2563eb"
SECONDARY_COLOR = "#0ea5e9"
ACCENT_COLOR = "#f97316"
ALT_COLOR = "#6366f1"

ALL_VALUE = "__all__"


def make_all_option(label: str = "Mostrar todos") -> Dict[str, str]:
    return {"label": label, "value": ALL_VALUE}

BASE_TABLE_STYLE = {
    "style_table": {
        "overflowX": "auto",
        "width": "100%",
        "maxWidth": "100%",
        "minWidth": "100%",
        "border": "1px solid rgba(148, 163, 184, 0.35)",
        "borderRadius": "18px",
        "padding": "0",
        "boxShadow": "0 14px 32px rgba(15, 23, 42, 0.08)",
    },
    "style_cell": {
        "textAlign": "center",
        "padding": "10px 12px",
        "fontFamily": "\"Segoe UI\", Helvetica, Arial, sans-serif",
        "fontSize": "0.85rem",
        "color": "#0f172a",
        "backgroundColor": "rgba(255, 255, 255, 0.96)",
        "minWidth": "70px",
        "maxWidth": "140px",
        "whiteSpace": "normal",
        "height": "auto",
        "overflow": "hidden",
    },
    "style_header": {
        "backgroundColor": "#0f172a",
        "color": "#f8fafc",
        "fontWeight": "700",
        "fontSize": "0.78rem",
        "textTransform": "uppercase",
        "letterSpacing": "0.06em",
        "border": "none",
        "padding": "12px 14px",
        "whiteSpace": "normal",
        "height": "auto",
    },
    "style_data": {
        "border": "none",
        "whiteSpace": "normal",
        "height": "auto",
    },
}

BASE_TABLE_CONDITIONAL = [
    {"if": {"row_index": "odd"}, "backgroundColor": "rgba(15, 23, 42, 0.02)"},
    {"if": {"column_id": "Categoria"}, "textAlign": "left", "fontWeight": "600"},
    {"if": {"column_id": "descricao_plano"}, "textAlign": "left", "fontWeight": "600"},
    {"if": {"column_id": "historico_nl"}, "textAlign": "left"},
]


def build_table_style(extra_conditional: Optional[List[dict]] = None) -> dict:
    styles = {
        key: value.copy()
        if isinstance(value, dict)
        else value[:] if isinstance(value, list) else value
        for key, value in BASE_TABLE_STYLE.items()
    }
    conditional = [cond.copy() for cond in BASE_TABLE_CONDITIONAL]
    if extra_conditional:
        conditional.extend(extra_conditional)
    styles["style_data_conditional"] = conditional
    return styles


def format_currency(value: Optional[float]) -> str:
    if value is None or pd.isna(value):
        return "-"
    return f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def format_percent(value: Optional[float]) -> str:
    if value is None or pd.isna(value):
        return "-"
    return f"{value * 100:,.1f}%".replace(",", "X").replace(".", ",").replace("X", ".")


def format_count(value: Optional[int]) -> str:
    if value is None or pd.isna(value):
        return "0"
    return f"{int(value):,}".replace(",", ".")


def format_date_label(value: Optional[pd.Timestamp]) -> str:
    if value is None or pd.isna(value):
        return "-"
    return pd.Timestamp(value).strftime("%d/%m/%Y")


def style_summary_table(df: pd.DataFrame, percent_column: Optional[str] = None) -> List[Dict[str, str]]:
    if df.empty:
        return []
    formatted = df.copy()
    currency_cols = [col for col in df.columns if col not in {"Categoria", percent_column}]
    for col in currency_cols:
        formatted[col] = formatted[col].apply(format_currency)
    if percent_column and percent_column in formatted.columns:
        formatted[percent_column] = formatted[percent_column].apply(format_percent)
    return formatted.to_dict("records")


def get_total_row(df: pd.DataFrame, keyword: str) -> pd.Series:
    if df.empty:
        return pd.Series(dtype=float)
    mask = df["Categoria"].astype(str).str.contains(keyword, case=False, na=False)
    if mask.any():
        return df[mask].iloc[0]
    return df.iloc[0]


def compute_nl_table(df: pd.DataFrame) -> Tuple[List[Dict[str, str]], List[Dict[str, str]]]:
    base_columns = [
        {"name": "Nº da NL", "id": "numero_nl"},
        {"name": "Data da NL", "id": "data_nl"},
        {"name": "Histórico da NL", "id": "historico_nl"},
    ]
    if df.empty:
        return base_columns, []

    pivot = (
        df.pivot_table(
            index=["numero_nl", "data_nl", "historico_nl"],
            columns=["categoria_limite", "fonte_sof"],
            values="valor",
            aggfunc="sum",
            fill_value=0.0,
        )
        .sort_index(axis=1)
        .reset_index()
    )

    new_columns = []
    for col in pivot.columns:
        if isinstance(col, tuple):
            categoria, fonte = col
            categoria_str = str(categoria).strip()
            fonte_str = str(fonte).strip() if fonte is not None else ""
            if fonte_str:
                if fonte_str.endswith(".0"):
                    fonte_str = fonte_str[:-2]
                if fonte_str.startswith("'") and fonte_str.endswith("'"):
                    fonte_str = fonte_str[1:-1]
                new_columns.append(f"{categoria_str} | {fonte_str}")
            else:
                new_columns.append(categoria_str)
        else:
            new_columns.append(str(col))
    pivot.columns = new_columns

    pivot["numero_nl"] = pivot["numero_nl"].astype(str).str.strip()
    pivot["data_nl"] = pd.to_datetime(pivot["data_nl"], errors="coerce").dt.strftime("%d/%m/%Y")
    pivot["historico_nl"] = pivot["historico_nl"].fillna("-").astype(str).str.strip()

    value_columns = [col for col in pivot.columns if col not in {"numero_nl", "data_nl", "historico_nl"}]
    for col in value_columns:
        pivot[col] = pivot[col].apply(lambda x: format_currency(x) if not pd.isna(x) else "-")

    columns = base_columns + [{"name": col, "id": col} for col in value_columns]
    data = pivot.to_dict("records")
    return columns, data


def sidebar_layout() -> html.Div:
    return html.Div(
        className="sidebar",
        children=[
            html.Div(
                className="sidebar-logo",
                children=[
                    html.Div("LO", className="logo-mark"),
                    html.Div(
                        className="logo-text",
                        children=[
                            html.Span("Limites LOA", className="logo-title"),
                            html.Span("Visão UnB 2025", className="logo-subtitle"),
                        ],
                    ),
                ],
            ),
            html.Div(
                className="sidebar-section",
                children=[
                    html.Span("Seções", className="sidebar-section-title"),
                    html.Button(
                        "Fonte Tesouro",
                        id="sidebar-tab-tesouro",
                        className="sidebar-link",
                        type="button",
                    ),
                    html.Button(
                        "Receita Própria",
                        id="sidebar-tab-receita",
                        className="sidebar-link",
                        type="button",
                    ),
                    html.Button(
                        "Notas de Limite",
                        id="sidebar-tab-nl",
                        className="sidebar-link",
                        type="button",
                    ),
                ],
            ),
            html.Div(
                className="sidebar-footer",
                children=[
                    html.Span("Projeto", className="sidebar-footer-label"),
                    html.Span("Universidade de Brasília • CPOR", className="sidebar-footer-text"),
                ],
            ),
        ],
    )


def render_tesouro_section() -> html.Div:
    return html.Div(
        className="section-card anchor-section",
        children=[
            html.Div(
                className="section-headline",
                children=[
                    html.H2("Fonte Tesouro", className="section-anchor-title"),
                    html.Span(
                        "Tabela consolidada da execução do Tesouro conforme planilha oficial.",
                        className="section-anchor-subtitle",
                    ),
                ],
            ),
            html.Div(
                className="kpi-row",
                children=[
                    html.Div(
                        className="kpi-card",
                        children=[
                            html.Span("Dotação Inicial", className="kpi-label"),
                            html.Span(id="kpi-tesouro-dotacao", className="kpi-value"),
                        ],
                    ),
                    html.Div(
                        className="kpi-card",
                        children=[
                            html.Span("Limite Liberado", className="kpi-label"),
                            html.Span(id="kpi-tesouro-limite", className="kpi-value"),
                        ],
                    ),
                    html.Div(
                        className="kpi-card",
                        children=[
                            html.Span("% Limite/Dotação", className="kpi-label"),
                            html.Span(id="kpi-tesouro-percentual", className="kpi-value"),
                        ],
                    ),
                    html.Div(
                        className="kpi-card alt",
                        children=[
                            html.Span("Limite Retido", className="kpi-label"),
                            html.Span(id="kpi-tesouro-retido", className="kpi-value"),
                        ],
                    ),
                    html.Div(
                        className="kpi-card",
                        children=[
                            html.Span("Empenhado", className="kpi-label"),
                            html.Span(id="kpi-tesouro-empenhado", className="kpi-value"),
                        ],
                    ),
                    html.Div(
                        className="kpi-card",
                        children=[
                            html.Span("A Empenhar", className="kpi-label"),
                            html.Span(id="kpi-tesouro-aempenhar", className="kpi-value"),
                        ],
                    ),
                ],
            ),
            html.Div(
                className="filters-inline",
                children=[
                    html.Div(
                        className="control-wrapper",
                        children=[
                            html.Label("Categoria", className="control-label"),
                            dcc.Dropdown(
                                id="tesouro-categoria-dropdown",
                                options=[make_all_option()],
                                value=ALL_VALUE,
                                clearable=False,
                                placeholder="Selecionar categoria",
                                className="control",
                                persistence=True,
                                persistence_type="session",
                            ),
                        ],
                    ),
                ],
            ),
            html.Div(
                className="table-container",
                children=[
                    dash_table.DataTable(
                        id="table-tesouro-summary",
                        columns=[],
                        data=[],
                        **build_table_style(),
                    ),
                ],
            ),
        ],
    )


def render_receita_section() -> html.Div:
    return html.Div(
        className="section-card anchor-section",
        children=[
            html.Div(
                className="section-headline",
                children=[
                    html.H2("Receita Própria — Depende de Arrecadação", className="section-anchor-title"),
                    html.Span(
                        "Tabela com dotações, limites e execução das fontes próprias.",
                        className="section-anchor-subtitle",
                    ),
                ],
            ),
            html.Div(
                className="kpi-row",
                children=[
                    html.Div(
                        className="kpi-card",
                        children=[
                            html.Span("Arrecadação 1050", className="kpi-label"),
                            html.Span(id="kpi-receita-arrecadacao", className="kpi-value"),
                        ],
                    ),
                    html.Div(
                        className="kpi-card",
                        children=[
                            html.Span("Limite Liberado", className="kpi-label"),
                            html.Span(id="kpi-receita-limite", className="kpi-value"),
                        ],
                    ),
                    html.Div(
                        className="kpi-card",
                        children=[
                            html.Span("% Limite/Arrec.", className="kpi-label"),
                            html.Span(id="kpi-receita-percentual", className="kpi-value"),
                        ],
                    ),
                    html.Div(
                        className="kpi-card alt",
                        children=[
                            html.Span("Dotação Inicial", className="kpi-label"),
                            html.Span(id="kpi-receita-dotacao", className="kpi-value"),
                        ],
                    ),
                    html.Div(
                        className="kpi-card",
                        children=[
                            html.Span("Empenhado", className="kpi-label"),
                            html.Span(id="kpi-receita-empenhado", className="kpi-value"),
                        ],
                    ),
                    html.Div(
                        className="kpi-card",
                        children=[
                            html.Span("A Empenhar", className="kpi-label"),
                            html.Span(id="kpi-receita-aempenhar", className="kpi-value"),
                        ],
                    ),
                ],
            ),
            html.Div(
                className="filters-inline",
                children=[
                    html.Div(
                        className="control-wrapper",
                        children=[
                            html.Label("Categoria", className="control-label"),
                            dcc.Dropdown(
                                id="receita-categoria-dropdown",
                                options=[make_all_option()],
                                value=ALL_VALUE,
                                clearable=False,
                                placeholder="Selecionar categoria",
                                className="control",
                                persistence=True,
                                persistence_type="session",
                            ),
                        ],
                    ),
                ],
            ),
            html.Div(
                className="table-container",
                children=[
                    dash_table.DataTable(
                        id="table-receita-summary",
                        columns=[],
                        data=[],
                        **build_table_style(),
                    ),
                ],
            ),
        ],
    )


def render_nl_section() -> html.Div:
    return html.Div(
        className="section-card anchor-section",
        children=[
            html.Div(
                className="section-headline",
                children=[
                    html.H2("Notas de Limite — Detalhamento por Fonte", className="section-anchor-title"),
                    html.Span(
                        "Tabela dinâmica por Nota de Limite com a distribuição por categoria e fonte.",
                        className="section-anchor-subtitle",
                    ),
                ],
            ),
            html.Div(
                className="kpi-row",
                children=[
                    html.Div(
                        className="kpi-card",
                        children=[
                            html.Span("Quantidade", className="kpi-label"),
                            html.Span(id="kpi-nl-total", className="kpi-value"),
                        ],
                    ),
                    html.Div(
                        className="kpi-card",
                        children=[
                            html.Span("Valor Total", className="kpi-label"),
                            html.Span(id="kpi-nl-valor", className="kpi-value"),
                        ],
                    ),
                    html.Div(
                        className="kpi-card alt",
                        children=[
                            html.Span("Custeio", className="kpi-label"),
                            html.Span(id="kpi-nl-custeio", className="kpi-value"),
                        ],
                    ),
                    html.Div(
                        className="kpi-card alt",
                        children=[
                            html.Span("Investimento", className="kpi-label"),
                            html.Span(id="kpi-nl-invest", className="kpi-value"),
                        ],
                    ),
                    html.Div(
                        className="kpi-card warning",
                        children=[
                            html.Span("Última Liberação", className="kpi-label"),
                            html.Span(id="kpi-nl-ultimo", className="kpi-value"),
                        ],
                    ),
                ],
            ),
            html.Div(
                className="filters-inline",
                children=[
                    html.Div(
                        className="control-wrapper",
                        children=[
                            html.Label("Fonte SOF", className="control-label"),
                            dcc.Dropdown(
                                id="nl-fonte-dropdown",
                                options=[make_all_option("Todas as fontes")],
                                value=ALL_VALUE,
                                clearable=False,
                                placeholder="Selecionar fonte",
                                className="control",
                                persistence=True,
                                persistence_type="session",
                            ),
                        ],
                    ),
                    html.Div(
                        className="control-wrapper",
                        children=[
                            html.Label("Tipo de Despesa", className="control-label"),
                            dcc.Dropdown(
                                id="nl-tipo-dropdown",
                                options=[make_all_option("Todos os tipos")],
                                value=ALL_VALUE,
                                clearable=False,
                                placeholder="Selecionar tipo",
                                className="control",
                                persistence=True,
                                persistence_type="session",
                            ),
                        ],
                    ),
                ],
            ),
            html.Div(
                className="table-container",
                children=[
                    dash_table.DataTable(
                        id="table-nl-pivot",
                        columns=[],
                        data=[],
                        **build_table_style(
                            [
                                {"if": {"column_id": "numero_nl"}, "textAlign": "left", "fontWeight": "600"},
                                {"if": {"column_id": "historico_nl"}, "textAlign": "left"},
                            ]
                        ),
                    ),
                ],
            ),
        ],
    )


def update_global_references(data: dict) -> None:
    global DATASETS
    DATASETS = data


update_global_references(load_datasets())


app = Dash(
    __name__,
    suppress_callback_exceptions=True,
    title="Dashboard Limites LOA 2025",
    requests_pathname_prefix=LOA_BASE_PATH,
)

app.layout = html.Div(
    className="layout",
    children=[
        sidebar_layout(),
        html.Div(
            className="main-area",
            children=[
                html.Div(
                    className="topbar",
                    children=[
                        html.Div(
                            children=[
                                html.H1("Dashboard Limites LOA 2025", className="topbar-title"),
                                html.Div(
                                    "Execução orçamentária e receitas – Universidade de Brasília",
                                    className="topbar-subtitle",
                                ),
                            ]
                        ),
                        html.Div(
                            className="topbar-actions",
                            children=[
                                dcc.Upload(
                                    id="upload-planilha",
                                    className="action-upload",
                                    multiple=False,
                                    children=html.Span("Atualizar planilha (.xlsx)", className="action-upload-label"),
                                ),
                                html.A("Sair do portal", href="/", className="topbar-exit"),
                            ],
                        ),
                    ],
                ),
                html.Div(id="upload-status", className="upload-status"),
                html.Div(
                    className="content",
                    children=[
                        html.Div(
                            id="sections-stack",
                            className="sections-stack",
                            children=[
                                html.Div(
                                    id="section-tesouro",
                                    className="section-wrapper",
                                    style={"display": "block"},
                                    children=render_tesouro_section(),
                                ),
                                html.Div(
                                    id="section-receita",
                                    className="section-wrapper",
                                    style={"display": "none"},
                                    children=render_receita_section(),
                                ),
                                html.Div(
                                    id="section-nl",
                                    className="section-wrapper",
                                    style={"display": "none"},
                                    children=render_nl_section(),
                                ),
                            ],
                        ),
                        dcc.Store(id="data-version", data=0),
                        dcc.Store(id="active-section", data="tesouro"),
                    ],
                ),
            ],
        ),
    ],
)


@app.callback(
    Output("active-section", "data"),
    Input("sidebar-tab-tesouro", "n_clicks"),
    Input("sidebar-tab-receita", "n_clicks"),
    Input("sidebar-tab-nl", "n_clicks"),
    State("active-section", "data"),
    prevent_initial_call=True,
)
def sidebar_navigate(
    tesouro_clicks: Optional[int],
    receita_clicks: Optional[int],
    nl_clicks: Optional[int],
    current: str,
) -> str:
    if not ctx.triggered_id:
        raise PreventUpdate
    match ctx.triggered_id:
        case "sidebar-tab-tesouro":
            return "tesouro"
        case "sidebar-tab-receita":
            return "receita"
        case "sidebar-tab-nl":
            return "nl"
        case _:
            return current


@app.callback(
    Output("sidebar-tab-tesouro", "className"),
    Output("sidebar-tab-receita", "className"),
    Output("sidebar-tab-nl", "className"),
    Output("section-tesouro", "style"),
    Output("section-receita", "style"),
    Output("section-nl", "style"),
    Input("active-section", "data"),
)
def update_section_visibility(active_section: str) -> Tuple[str, str, str, Dict[str, str], Dict[str, str], Dict[str, str]]:
    base_class = "sidebar-link"
    active_class = f"{base_class} active"

    def style_for(section: str) -> Dict[str, str]:
        return {"display": "block"} if active_section == section else {"display": "none"}

    return (
        active_class if active_section == "tesouro" else base_class,
        active_class if active_section == "receita" else base_class,
        active_class if active_section == "nl" else base_class,
        style_for("tesouro"),
        style_for("receita"),
        style_for("nl"),
    )


@app.callback(
    Output("tesouro-categoria-dropdown", "options"),
    Output("tesouro-categoria-dropdown", "value"),
    Output("receita-categoria-dropdown", "options"),
    Output("receita-categoria-dropdown", "value"),
    Output("nl-fonte-dropdown", "options"),
    Output("nl-fonte-dropdown", "value"),
    Output("nl-tipo-dropdown", "options"),
    Output("nl-tipo-dropdown", "value"),
    Input("data-version", "data"),
)
def populate_dropdowns(_: int):
    tesouro = DATASETS["tesouro_summary"]
    receita = DATASETS["receita_summary"]

    tesouro_categorias = (
        tesouro["Categoria"]
        .dropna()
        .astype(str)
        .str.strip()
        .replace("", pd.NA)
        .dropna()
        .unique()
        .tolist()
    )
    tesouro_categorias.sort()

    receita_categorias = (
        receita["Categoria"]
        .dropna()
        .astype(str)
        .str.strip()
        .replace("", pd.NA)
        .dropna()
        .unique()
        .tolist()
    )
    receita_categorias.sort()

    fonte_values = sorted(
        {
            str(fonte).strip()
            for fonte in DATASETS["fonte_options"]
            if str(fonte).strip()
        }
    )
    tipo_values = (
        DATASETS["fact_nl"]["tipo_despesa"]
        .dropna()
        .astype(str)
        .str.strip()
        .replace("", pd.NA)
        .dropna()
        .unique()
        .tolist()
    )
    tipo_values.sort()

    return (
        [make_all_option()] + [{"label": cat, "value": cat} for cat in tesouro_categorias],
        ALL_VALUE,
        [make_all_option()] + [{"label": cat, "value": cat} for cat in receita_categorias],
        ALL_VALUE,
        [make_all_option("Todas as fontes")] + [{"label": fonte, "value": fonte} for fonte in fonte_values],
        ALL_VALUE,
        [make_all_option("Todos os tipos")] + [{"label": tipo, "value": tipo} for tipo in tipo_values],
        ALL_VALUE,
    )


@app.callback(
    Output("table-tesouro-summary", "columns"),
    Output("table-tesouro-summary", "data"),
    Input("tesouro-categoria-dropdown", "value"),
    Input("data-version", "data"),
)
def update_tesouro_table(categoria: Optional[str], _: int):
    df = DATASETS["tesouro_summary"]
    if categoria and categoria != ALL_VALUE:
        df = df[df["Categoria"] == categoria]
    columns = [{"name": col, "id": col} for col in df.columns]
    data = style_summary_table(df, "% LIMITE LIBERADO (Total Lim. Lib./Dot Inic.)")
    return columns, data


@app.callback(
    Output("table-receita-summary", "columns"),
    Output("table-receita-summary", "data"),
    Input("receita-categoria-dropdown", "value"),
    Input("data-version", "data"),
)
def update_receita_table(categoria: Optional[str], _: int):
    df = DATASETS["receita_summary"]
    if categoria and categoria != ALL_VALUE:
        df = df[df["Categoria"] == categoria]
    columns = [{"name": col, "id": col} for col in df.columns]
    data = style_summary_table(df, "% LIMITE LIBERADO (Total Lim. Lib./Arrecadação)")
    return columns, data


@app.callback(
    Output("table-nl-pivot", "columns"),
    Output("table-nl-pivot", "data"),
    Input("nl-fonte-dropdown", "value"),
    Input("nl-tipo-dropdown", "value"),
    Input("data-version", "data"),
)
def update_nl_table(fonte_value: Optional[str], tipo_value: Optional[str], _: int):
    filtered = DATASETS["fact_nl"]
    if fonte_value and fonte_value != ALL_VALUE:
        fonte_series = filtered["fonte_sof"].astype(str).str.strip()
        filtered = filtered[fonte_series == fonte_value]
    if tipo_value and tipo_value != ALL_VALUE:
        tipo_series = filtered["tipo_despesa"].astype(str).str.strip()
        filtered = filtered[tipo_series == tipo_value]
    return compute_nl_table(filtered)


@app.callback(
    Output("kpi-tesouro-dotacao", "children"),
    Output("kpi-tesouro-limite", "children"),
    Output("kpi-tesouro-percentual", "children"),
    Output("kpi-tesouro-retido", "children"),
    Output("kpi-tesouro-empenhado", "children"),
    Output("kpi-tesouro-aempenhar", "children"),
    Output("kpi-receita-arrecadacao", "children"),
    Output("kpi-receita-limite", "children"),
    Output("kpi-receita-percentual", "children"),
    Output("kpi-receita-dotacao", "children"),
    Output("kpi-receita-empenhado", "children"),
    Output("kpi-receita-aempenhar", "children"),
    Output("kpi-nl-total", "children"),
    Output("kpi-nl-valor", "children"),
    Output("kpi-nl-custeio", "children"),
    Output("kpi-nl-invest", "children"),
    Output("kpi-nl-ultimo", "children"),
    Input("data-version", "data"),
)
def update_summary_tables(_: int):
    tesouro = DATASETS["tesouro_summary"]
    receita = DATASETS["receita_summary"]
    fact_nl = DATASETS["fact_nl"]

    total_tesouro = get_total_row(tesouro, "TOTAL")
    total_receita = get_total_row(receita, "TOTAL")

    total_nl = len(fact_nl)
    valor_total_nl = fact_nl["valor"].sum() if total_nl else 0.0
    valor_custeio = fact_nl.loc[fact_nl["tipo_despesa"] == "Custeio", "valor"].sum()
    valor_invest = fact_nl.loc[fact_nl["tipo_despesa"] == "Investimento", "valor"].sum()
    ultima_nl = fact_nl["data_nl"].max() if total_nl else None

    return (
        format_currency(total_tesouro.get("DOTAÇÃO INICIAL 2025 (sem emendas)")),
        format_currency(total_tesouro.get("TOTAL LIMITE LIBERADO")),
        format_percent(total_tesouro.get("% LIMITE LIBERADO (Total Lim. Lib./Dot Inic.)")),
        format_currency(total_tesouro.get("LIMITE RETIDO")),
        format_currency(total_tesouro.get("EMPENHADO")),
        format_currency(total_tesouro.get("A EMPENHAR")),
        format_currency(total_receita.get("ARRECADAÇÃO (1050)")),
        format_currency(total_receita.get("LIMITE LIBERADO 2024")),
        format_percent(total_receita.get("% LIMITE LIBERADO (Total Lim. Lib./Arrecadação)")),
        format_currency(total_receita.get("DOTAÇÃO INICIAL 2025 (sem emendas)")),
        format_currency(total_receita.get("EMPENHADO")),
        format_currency(total_receita.get("A EMPENHAR")),
        format_count(total_nl),
        format_currency(valor_total_nl),
        format_currency(valor_custeio),
        format_currency(valor_invest),
        format_date_label(ultima_nl),
    )


@app.callback(
    Output("upload-status", "children"),
    Output("data-version", "data"),
    Input("upload-planilha", "contents"),
    State("upload-planilha", "filename"),
    State("data-version", "data"),
    prevent_initial_call=True,
)
def upload_handler(contents: Optional[str], filename: Optional[str], version: int):
    if contents is None or not filename:
        raise PreventUpdate
    destination = save_uploaded_excel(contents, filename)
    update_global_references(refresh_global_datasets(destination))
    return (
        f"Planilha carregada com sucesso: {filename}",
        version + 1,
    )


def main() -> None:
    app.run(debug=True)


if __name__ == "__main__":
    main()
