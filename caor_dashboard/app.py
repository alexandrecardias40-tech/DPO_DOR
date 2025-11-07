from __future__ import annotations

import base64
import os
from typing import Dict, List, Optional, Sequence, Tuple

import pandas as pd
import plotly.express as px
from dash import Dash, Input, Output, State, dash_table, dcc, html, no_update, ctx
from dash.exceptions import PreventUpdate

from .data_processing import BASE_DIR, load_datasets


def _normalize_base_path(env_var: str, default: str = "/") -> str:
    path = os.getenv(env_var, default).strip() or default
    if not path.startswith("/"):
        path = f"/{path}"
    if not path.endswith("/"):
        path = f"{path}/"
    return path


CAOR_BASE_PATH = _normalize_base_path("CAOR_DASH_BASEPATH")

PRIMARY_COLOR = "#2563eb"
SECONDARY_COLOR = "#0ea5e9"
EMPHASIS_COLOR = "#6366f1"
ACCENT_COLOR = "#f97316"
NEUTRAL_COLOR = "#94a3b8"

BAR_COLOR_MAP = {
    "credito_disponivel": PRIMARY_COLOR,
    "empenhado": EMPHASIS_COLOR,
    "total_credito_ptres_230639": PRIMARY_COLOR,
    "despesas_empenhadas": ACCENT_COLOR,
}

CATEGORIA_COLOR_MAP = {
    "Matriz Acadêmica": PRIMARY_COLOR,
    "Matriz Administrativa": EMPHASIS_COLOR,
    "Demais créditos": ACCENT_COLOR,
}

MATRIZ_KPI_MAP = {
    "btn-kpi-matriz-total-aprovado": "total_aprovado",
    "btn-kpi-matriz-credito-disponivel": "credito_disponivel",
    "btn-kpi-matriz-empenhado": "empenhado",
    "btn-kpi-matriz-debitos": "debitos",
    "btn-kpi-matriz-total-executado": "total_executado",
    "btn-kpi-matriz-saldo": "saldo",
    "btn-kpi-matriz-pct-execucao": "pct_execucao",
}

MATRIZ_KPI_LABELS = {
    "total_aprovado": "Total aprovado",
    "credito_disponivel": "Crédito disponível",
    "empenhado": "Empenhado",
    "debitos": "Débitos",
    "total_executado": "Total executado",
    "saldo": "Saldo vs empenhado",
    "pct_execucao": "% empenhado / aprovado",
}

MATRIZ_DEFAULT_METRIC = "credito_disponivel"

CREDITOS_KPI_MAP = {
    "btn-kpi-creditos-total": "total_credito_ptres_230639",
    "btn-kpi-creditos-academica": "Matriz Acadêmica (MGY01N0104N)",
    "btn-kpi-creditos-administrativa": "Matriz Administrativa (VGY01N0105N)",
    "btn-kpi-creditos-demais": "Demais créditos PTRES 230639",
    "btn-kpi-creditos-despesas": "despesas_empenhadas",
    "btn-kpi-creditos-percentual": "pct_credito_empenhado",
}

CREDITOS_KPI_LABELS = {
    "total_credito_ptres_230639": "Total crédito PTRES",
    "Matriz Acadêmica (MGY01N0104N)": "Matriz acadêmica",
    "Matriz Administrativa (VGY01N0105N)": "Matriz administrativa",
    "Demais créditos PTRES 230639": "Demais créditos",
    "despesas_empenhadas": "Despesas empenhadas",
    "pct_credito_empenhado": "% despesas / crédito",
}

CREDITOS_DEFAULT_METRIC = "total_credito_ptres_230639"

GRAPH_CONFIG = {
    "displaylogo": False,
    "displayModeBar": "hover",
    "responsive": True,
    "modeBarButtonsToRemove": [
        "zoomIn2d",
        "zoomOut2d",
        "autoScale2d",
        "resetScale2d",
        "hoverClosestCartesian",
        "hoverCompareCartesian",
        "toggleSpikelines",
        "toImage",
    ],
}


def update_global_references(data: dict) -> None:
    global datasets
    global MATRIZ_DF, CREDITO_DETALHADO_DF, CONRAZAO_DF, CREDITOS_CATEGORIA_DF
    global UNIDADES_LIST, PI_LIST, PI_OPTIONS, UNIDADE_OPTIONS

    datasets = data
    MATRIZ_DF = datasets["matriz"]
    CREDITO_DETALHADO_DF = datasets["credito_detalhado"]
    CONRAZAO_DF = datasets["conrazao_ptres"]
    CREDITOS_CATEGORIA_DF = datasets["creditos_categoria"]
    UNIDADES_LIST = datasets["unidades"]
    PI_LIST = sorted(MATRIZ_DF["pi"].dropna().unique().tolist())
    PI_OPTIONS = [{"label": valor, "value": valor} for valor in PI_LIST]
    UNIDADE_OPTIONS = [{"label": unidade, "value": unidade} for unidade in UNIDADES_LIST]


def refresh_global_datasets() -> None:
    load_datasets.cache_clear()
    update_global_references(load_datasets())


def save_uploaded_excel(contents: str, destination_name: str) -> str:
    if not contents:
        raise ValueError("Arquivo vazio")
    if "," not in contents:
        raise ValueError("Conteúdo inválido")
    _, encoded = contents.split(",", 1)
    data = base64.b64decode(encoded)
    destination_path = BASE_DIR / destination_name
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    destination_path.write_bytes(data)
    return str(destination_path)

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
    {"if": {"column_id": "unidade"}, "textAlign": "left", "fontWeight": "600"},
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


def filter_dataframe(
    df: pd.DataFrame,
    unidades: Optional[Sequence[str]] = None,
    valores_pi: Optional[Sequence[str]] = None,
) -> pd.DataFrame:
    filtered = df.copy()
    if unidades:
        filtered = filtered[filtered["unidade"].isin(unidades)]
    if valores_pi:
        filtered = filtered[filtered["pi"].isin(valores_pi)]
    return filtered


def build_matriz_summary(df: pd.DataFrame) -> Tuple[pd.DataFrame, dict]:
    if df.empty:
        vazio = pd.DataFrame(
            columns=[
                "unidade",
                "total_aprovado",
                "credito_disponivel",
                "empenhado",
                "debitos",
                "total_executado",
                "saldo",
                "pct_execucao",
                "pct_empenhado_credito",
            ]
        )
        return vazio, {
            "total_aprovado": 0.0,
            "credito_disponivel": 0.0,
            "empenhado": 0.0,
            "debitos": 0.0,
            "total_executado": 0.0,
            "saldo": 0.0,
            "pct_execucao": 0.0,
            "pct_credito": 0.0,
        }

    agrupado = (
        df.groupby("unidade", as_index=False)[
            [
                "total_aprovado",
                "credito_disponivel",
                "empenhado",
                "debitos",
                "total_executado",
                "saldo",
            ]
        ]
        .sum()
    )
    agrupado["pct_execucao"] = agrupado.apply(
        lambda row: row["empenhado"] / row["total_aprovado"]
        if row["total_aprovado"]
        else 0.0,
        axis=1,
    )
    agrupado["pct_empenhado_credito"] = agrupado.apply(
        lambda row: row["empenhado"] / row["credito_disponivel"]
        if row["credito_disponivel"]
        else 0.0,
        axis=1,
    )

    totais = {
        coluna: agrupado[coluna].sum()
        for coluna in [
            "total_aprovado",
            "credito_disponivel",
            "empenhado",
            "debitos",
            "total_executado",
            "saldo",
        ]
    }

    totais["pct_execucao"] = (
        totais["empenhado"] / totais["total_aprovado"]
        if totais["total_aprovado"]
        else 0.0
    )
    totais["pct_credito"] = (
        totais["empenhado"] / totais["credito_disponivel"]
        if totais["credito_disponivel"]
        else 0.0
    )

    return agrupado, totais


def build_creditos_summary(
    creditos_categoria: pd.DataFrame,
    credito_detalhado: pd.DataFrame,
    conrazao_df: pd.DataFrame,
    unidades: Optional[Sequence[str]],
    categorias: Optional[Sequence[str]],
) -> Tuple[pd.DataFrame, dict, pd.DataFrame]:
    categorias_padrao = [
        "Matriz Acadêmica (MGY01N0104N)",
        "Matriz Administrativa (VGY01N0105N)",
        "Demais créditos PTRES 230639",
    ]

    categorias_utilizadas = categorias if categorias else categorias_padrao

    creditos = creditos_categoria.copy()
    if unidades:
        creditos = creditos[creditos["unidade"].isin(unidades)]

    creditos["total_categoria_selecionada"] = creditos[
        [c for c in categorias_padrao if c in creditos.columns]
    ].sum(axis=1)

    creditos["total_categoria_filtrada"] = creditos[
        [c for c in categorias_utilizadas if c in creditos.columns]
    ].sum(axis=1)

    credito_agregado = (
        credito_detalhado.groupby("unidade", as_index=False)[
            ["credito_disponivel", "despesas_empenhadas", "saldo"]
        ]
        .sum()
    )
    if unidades:
        credito_agregado = credito_agregado[
            credito_agregado["unidade"].isin(unidades)
        ]

    resumo = pd.merge(
        creditos,
        credito_agregado,
        on="unidade",
        how="outer",
    ).fillna(0.0)
    resumo["diferenca_credito"] = (
        resumo["total_credito_ptres_230639"] - resumo["credito_disponivel"]
    )
    resumo = resumo.sort_values("total_credito_ptres_230639", ascending=False).reset_index(
        drop=True
    )

    totais = {
        "matriz_academica": resumo.get(
            "Matriz Acadêmica (MGY01N0104N)", pd.Series(dtype=float)
        ).sum(),
        "matriz_administrativa": resumo.get(
            "Matriz Administrativa (VGY01N0105N)", pd.Series(dtype=float)
        ).sum(),
        "demais_creditos": resumo.get(
            "Demais créditos PTRES 230639", pd.Series(dtype=float)
        ).sum(),
        "despesas": resumo["despesas_empenhadas"].sum(),
        "credito_planilha": resumo["credito_disponivel"].sum(),
    }
    totais["total_credito"] = (
        totais["matriz_academica"]
        + totais["matriz_administrativa"]
        + totais["demais_creditos"]
    )
    totais["saldo"] = resumo["saldo"].sum()
    totais["gap_credito_consolidado_vs_planilha"] = (
        totais["total_credito"] - totais["credito_planilha"]
    )
    totais["pct_credito_empenhado"] = (
        totais["despesas"] / totais["total_credito"]
        if totais["total_credito"]
        else 0.0
    )

    natureza = conrazao_df.copy()
    if unidades:
        natureza = natureza[natureza["unidade"].isin(unidades)]
    if categorias:
        natureza = natureza[natureza["categoria_pi"].isin(categorias)]

    natureza = (
        natureza.groupby(
            ["unidade", "categoria_pi", "item_informacao", "descricao_natureza"],
            as_index=False,
        )["credito_disponivel"]
        .sum()
    )

    return resumo, totais, natureza


update_global_references(load_datasets())

CATEGORIA_OPTIONS = [
    {"label": "Matriz Acadêmica (MGY01N0104N)", "value": "Matriz Acadêmica (MGY01N0104N)"},
    {"label": "Matriz Administrativa (VGY01N0105N)", "value": "Matriz Administrativa (VGY01N0105N)"},
    {"label": "Demais créditos PTRES 230639", "value": "Demais créditos PTRES 230639"},
]
UNIDADE_OPTIONS = [{"label": unidade, "value": unidade} for unidade in UNIDADES_LIST]

def render_matriz_page() -> html.Div:
    matriz_table_styles = build_table_style()

    return html.Div(
        className="page-content matriz-page",
        children=[
            html.Div(
                className="filters-card",
                children=[
                    html.Div(
                        className="section-header",
                        children=[
                            html.Span("Filtros da Matriz", className="section-title"),
                            html.Span(
                                "Aplique recortes para analisar unidades específicas ou PIs.",
                                className="section-subtitle",
                            ),
                        ],
                    ),
                    html.Div(
                        className="filters-row",
                        children=[
                            html.Div(
                                className="control-wrapper",
                                children=[
                                    html.Label("Unidades", className="control-label"),
                                    dcc.Dropdown(
                                        id="matriz-unidades",
                                        options=UNIDADE_OPTIONS,
                                        multi=True,
                                        placeholder="Selecione uma ou mais unidades",
                                        className="control",
                                    ),
                                ],
                            ),
                            html.Div(
                                className="control-wrapper",
                                children=[
                                    html.Label("PI", className="control-label"),
                                    dcc.Dropdown(
                                        id="matriz-pi",
                                        options=PI_OPTIONS,
                                        multi=True,
                                        placeholder="Todos os valores",
                                        className="control",
                                    ),
                                ],
                            ),
                        ],
                    ),
                    html.Div(
                        className="upload-wrapper",
                        children=[
                            dcc.Upload(
                                id="upload-matriz",
                                accept=".xlsx,.xls",
                                className="action-upload",
                                children=html.Span(
                                    "Selecionar nova planilha da Matriz (.xlsx)",
                                    className="action-upload-label",
                                ),
                                multiple=False,
                            ),
                            html.Div(id="upload-matriz-status", className="upload-status"),
                        ],
                    ),
                ],
            ),
            html.Div(
                className="card-block kpi-block",
                children=[
                    html.Div(
                        className="card-header",
                        children=[
                            html.Span("Indicadores consolidados", className="card-title"),
                            html.Span(
                                "Saldo calculado a partir do crédito disponível menos o valor empenhado.",
                                className="card-subtitle",
                            ),
                        ],
                    ),
                    html.Div(
                        className="kpi-container",
                        children=[
                            html.Button(
                                id="btn-kpi-matriz-total-aprovado",
                                type="button",
                                className="kpi-card",
                                children=[
                                    html.Span("Total aprovado", className="kpi-label"),
                                    html.Span(id="kpi-total-aprovado", className="kpi-value"),
                                ],
                            ),
                            html.Button(
                                id="btn-kpi-matriz-credito-disponivel",
                                type="button",
                                className="kpi-card",
                                children=[
                                    html.Span("Crédito disponível", className="kpi-label"),
                                    html.Span(id="kpi-credito-disponivel", className="kpi-value"),
                                ],
                            ),
                            html.Button(
                                id="btn-kpi-matriz-empenhado",
                                type="button",
                                className="kpi-card",
                                children=[
                                    html.Span("Empenhado", className="kpi-label"),
                                    html.Span(id="kpi-empenhado", className="kpi-value"),
                                ],
                            ),
                            html.Button(
                                id="btn-kpi-matriz-debitos",
                                type="button",
                                className="kpi-card",
                                children=[
                                    html.Span("Débitos", className="kpi-label"),
                                    html.Span(id="kpi-debitos", className="kpi-value"),
                                ],
                            ),
                            html.Button(
                                id="btn-kpi-matriz-total-executado",
                                type="button",
                                className="kpi-card",
                                children=[
                                    html.Span("Total executado", className="kpi-label"),
                                    html.Span(id="kpi-total-executado", className="kpi-value"),
                                ],
                            ),
                            html.Button(
                                id="btn-kpi-matriz-saldo",
                                type="button",
                                className="kpi-card",
                                children=[
                                    html.Span("Saldo vs empenhado", className="kpi-label"),
                                    html.Span(id="kpi-saldo", className="kpi-value"),
                                ],
                            ),
                            html.Button(
                                id="btn-kpi-matriz-pct-execucao",
                                type="button",
                                className="kpi-card",
                                children=[
                                    html.Span("% empenhado / aprovado", className="kpi-label"),
                                    html.Span(id="kpi-pct-execucao", className="kpi-value"),
                                ],
                            ),
                        ],
                    ),
                ],
            ),
            html.Div(id="matriz-alertas", className="alert-card"),
            html.Div(id="matriz-highlight", className="insight-card"),
            html.Div(
                className="card-block",
                children=[
                    html.Div(
                        className="card-header",
                        children=[
                            html.Span(
                                "Crédito disponível vs empenhado",
                                className="card-title",
                            ),
                            html.Span(
                                "Clique para investigar unidades críticas e use o botão para limpar a seleção.",
                                className="card-subtitle",
                            ),
                        ],
                    ),
                    html.Div(
                        className="drill-controls",
                        children=[
                            html.Button(
                                "Limpar seleção",
                                id="btn-clear-matriz",
                                className="action-upload secondary",
                            )
                        ],
                    ),
                    dcc.Graph(id="grafico-matriz", className="graph", config=GRAPH_CONFIG),
                ],
            ),
            html.Div(
                className="card-block",
                children=[
                    html.Div(
                        className="card-header",
                        children=[
                            html.Span(
                                "Composição da Matriz",
                                className="card-title",
                            ),
                            html.Span(
                                "Barras ordenadas por PI; clique em um PI para detalhar a tabela abaixo.",
                                className="card-subtitle",
                            ),
                        ],
                    ),
                    dcc.Graph(id="grafico-matriz-estrutura", className="graph", config=GRAPH_CONFIG),
                ],
            ),
            html.Div(
                className="card-block",
                children=[
                    html.Div(
                        className="card-header",
                        children=[
                            html.Span(
                                "Taxa de execução por unidade",
                                className="card-title",
                            ),
                            html.Span(
                                "Identifique unidades com execução acima ou abaixo da média.",
                                className="card-subtitle",
                            ),
                        ],
                    ),
                    dcc.Graph(id="grafico-matriz-execucao", className="graph", config=GRAPH_CONFIG),
                ],
            ),
            html.Div(
                className="card-block",
                children=[
                    html.Div(
                        className="card-header",
                        children=[
                            html.Span(
                                "Tabela detalhada por unidade",
                                className="card-title",
                            ),
                            html.Span(
                                "Inclui totais aprovados, crédito disponível, empenho e saldo calculado.",
                                className="card-subtitle",
                            ),
                            html.Span(
                                "Ordenado por crédito disponível.",
                                id="matriz-table-caption",
                                className="card-subtitle hint-text",
                            ),
                        ],
                    ),
                    dash_table.DataTable(
                        id="tabela-matriz",
                        columns=[
                            {"name": "Unidade", "id": "unidade"},
                            {"name": "Total aprovado", "id": "total_aprovado"},
                            {"name": "Crédito disponível", "id": "credito_disponivel"},
                            {"name": "Empenhado", "id": "empenhado"},
                            {"name": "Débitos", "id": "debitos"},
                            {"name": "Saldo", "id": "saldo"},
                            {"name": "% empenhado / aprovado", "id": "pct_execucao"},
                            {"name": "% empenhado / crédito", "id": "pct_empenhado_credito"},
                        ],
                        data=[],
                        sort_action="native",
                        page_size=15,
                        **matriz_table_styles,
                    ),
                ],
            ),
            html.Div(
                className="card-block",
                children=[
                    html.Div(
                        className="card-header",
                        children=[
                            html.Span(
                                "Detalhamento por PI",
                                className="card-title",
                            ),
                            html.Span(
                                "Tabela filtrada conforme seleção nos gráficos ou filtros.",
                                className="card-subtitle",
                            ),
                            html.Span(
                                "Detalhamento prioriza crédito disponível.",
                                id="matriz-detalhe-caption",
                                className="card-subtitle hint-text",
                            ),
                        ],
                    ),
                    dash_table.DataTable(
                        id="tabela-matriz-detalhe",
                        columns=[
                            {"name": "Unidade", "id": "unidade"},
                            {"name": "PI", "id": "pi"},
                            {"name": "Total aprovado", "id": "total_aprovado"},
                            {"name": "Crédito disponível", "id": "credito_disponivel"},
                            {"name": "Empenhado", "id": "empenhado"},
                            {"name": "Débitos", "id": "debitos"},
                            {"name": "Saldo", "id": "saldo"},
                            {"name": "% execução", "id": "pct_execucao"},
                        ],
                        data=[],
                        sort_action="native",
                        page_size=15,
                        **matriz_table_styles,
                    ),
                ],
            ),
        ],
    )


def render_creditos_page() -> html.Div:
    creditos_table_styles = build_table_style()
    natureza_table_styles = build_table_style()

    return html.Div(
        className="page-content creditos-page",
        children=[
            html.Div(
                className="filters-card",
                children=[
                    html.Div(
                        className="section-header",
                        children=[
                            html.Span("Filtros de créditos", className="section-title"),
                            html.Span(
                                "Combine unidades e categorias do PTRES 230639 para focar o monitoramento.",
                                className="section-subtitle",
                            ),
                        ],
                    ),
                    html.Div(
                        className="filters-row",
                        children=[
                            html.Div(
                                className="control-wrapper",
                                children=[
                                    html.Label("Unidades", className="control-label"),
                                    dcc.Dropdown(
                                        id="creditos-unidades",
                                        options=UNIDADE_OPTIONS,
                                        multi=True,
                                        placeholder="Selecione unidades (opcional)",
                                        className="control",
                                    ),
                                ],
                            ),
                            html.Div(
                                className="control-wrapper",
                                children=[
                                    html.Label(
                                        "Categorias PTRES 230639",
                                        className="control-label",
                                    ),
                                    dcc.Checklist(
                                        id="creditos-categorias",
                                        options=CATEGORIA_OPTIONS,
                                        value=[item["value"] for item in CATEGORIA_OPTIONS],
                                        inline=True,
                                        className="checkbox-group",
                                    ),
                                ],
                            ),
                        ],
                    ),
                    html.Div(
                        className="upload-wrapper",
                        children=[
                            dcc.Upload(
                                id="upload-creditos",
                                accept=".xlsx,.xls",
                                className="action-upload",
                                children=html.Span(
                                    "Selecionar nova planilha de Créditos (.xlsx)",
                                    className="action-upload-label",
                                ),
                            ),
                            html.Div(id="upload-creditos-status", className="upload-status"),
                        ],
                    ),
                ],
            ),
            html.Div(
                className="card-block kpi-block",
                children=[
                    html.Div(
                        className="card-header",
                        children=[
                            html.Span(
                                "Créditos PTRES 230639",
                                className="card-title",
                            ),
                            html.Span(
                                "Inclui matrizes acadêmica e administrativa, além dos demais créditos próprios.",
                                className="card-subtitle",
                            ),
                        ],
                    ),
                    html.Div(
                        className="kpi-container",
                        children=[
                            html.Button(
                                id="btn-kpi-creditos-total",
                                type="button",
                                className="kpi-card",
                                children=[
                                    html.Span("Total crédito PTRES 230639", className="kpi-label"),
                                    html.Span(id="kpi-creditos-total", className="kpi-value"),
                                ],
                            ),
                            html.Button(
                                id="btn-kpi-creditos-academica",
                                type="button",
                                className="kpi-card",
                                children=[
                                    html.Span("Matriz acadêmica", className="kpi-label"),
                                    html.Span(
                                        id="kpi-creditos-matriz-academica",
                                        className="kpi-value",
                                    ),
                                ],
                            ),
                            html.Button(
                                id="btn-kpi-creditos-administrativa",
                                type="button",
                                className="kpi-card",
                                children=[
                                    html.Span("Matriz administrativa", className="kpi-label"),
                                    html.Span(
                                        id="kpi-creditos-matriz-administrativa",
                                        className="kpi-value",
                                    ),
                                ],
                            ),
                            html.Button(
                                id="btn-kpi-creditos-demais",
                                type="button",
                                className="kpi-card",
                                children=[
                                    html.Span("Demais créditos", className="kpi-label"),
                                    html.Span(id="kpi-creditos-demais", className="kpi-value"),
                                ],
                            ),
                            html.Button(
                                id="btn-kpi-creditos-despesas",
                                type="button",
                                className="kpi-card",
                                children=[
                                    html.Span("Despesas empenhadas", className="kpi-label"),
                                    html.Span(id="kpi-creditos-despesas", className="kpi-value"),
                                ],
                            ),
                            html.Button(
                                id="btn-kpi-creditos-percentual",
                                type="button",
                                className="kpi-card",
                                children=[
                                    html.Span("% despesas / crédito", className="kpi-label"),
                                    html.Span(
                                        id="kpi-creditos-percentual-empenhado",
                                        className="kpi-value",
                                    ),
                                ],
                            ),
                        ],
                    ),
                ],
            ),
            html.Div(id="creditos-alertas", className="alert-card"),
            html.Div(id="creditos-highlight", className="insight-card"),
            html.Div(
                className="card-block",
                children=[
                    html.Div(
                        className="card-header",
                        children=[
                            html.Span(
                                "Distribuição dos créditos por categoria",
                                className="card-title",
                            ),
                            html.Span(
                                "Valores consolidados por unidade, segmentados por matrizes e demais créditos.",
                                className="card-subtitle",
                            ),
                        ],
                    ),
                    html.Div(
                        className="drill-controls",
                        children=[
                            html.Button(
                                "Limpar seleção",
                                id="btn-clear-creditos",
                                className="action-upload secondary",
                            )
                        ],
                    ),
                    dcc.Graph(id="grafico-creditos-categoria", className="graph", config=GRAPH_CONFIG),
                ],
            ),
            html.Div(
                className="card-block",
                children=[
                    html.Div(
                        className="card-header",
                        children=[
                            html.Span(
                                "Participação por categoria",
                                className="card-title",
                            ),
                            html.Span(
                                "Barras permitem clicar nas categorias para detalhar as tabelas.",
                                className="card-subtitle",
                            ),
                        ],
                    ),
                    dcc.Graph(id="grafico-creditos-pizza", className="graph", config=GRAPH_CONFIG),
                ],
            ),
            html.Div(
                className="card-block",
                children=[
                    html.Div(
                        className="card-header",
                        children=[
                            html.Span(
                                "Crédito total x despesas empenhadas",
                                className="card-title",
                            ),
                            html.Span(
                                "Compara o consolidado do PTRES 230639 com o registro de despesas.",
                                className="card-subtitle",
                            ),
                        ],
                    ),
                    dcc.Graph(id="grafico-creditos-vs-despesas", className="graph", config=GRAPH_CONFIG),
                ],
            ),
            html.Div(
                className="card-block",
                children=[
                    html.Div(
                        className="card-header",
                        children=[
                            html.Span(
                                "Resumo por unidade",
                                className="card-title",
                            ),
                            html.Span(
                                "Compara o total consolidado do PTRES e os valores da planilha operacional.",
                                className="card-subtitle",
                            ),
                            html.Span(
                                "Ordenado por crédito total.",
                                id="creditos-table-caption",
                                className="card-subtitle hint-text",
                            ),
                        ],
                    ),
                    dash_table.DataTable(
                        id="tabela-creditos",
                        columns=[
                            {"name": "Unidade", "id": "unidade"},
                            {
                                "name": "Matriz Acadêmica (MGY01N0104N)",
                                "id": "Matriz Acadêmica (MGY01N0104N)",
                            },
                            {
                                "name": "Matriz Administrativa (VGY01N0105N)",
                                "id": "Matriz Administrativa (VGY01N0105N)",
                            },
                            {
                                "name": "Demais créditos PTRES 230639",
                                "id": "Demais créditos PTRES 230639",
                            },
                            {
                                "name": "Total crédito PTRES",
                                "id": "total_credito_ptres_230639",
                            },
                            {
                                "name": "Diferença (PTRES - planilha)",
                                "id": "diferenca_credito",
                            },
                            {"name": "Crédito planilha executada", "id": "credito_disponivel"},
                            {"name": "Despesas empenhadas", "id": "despesas_empenhadas"},
                            {"name": "Saldo planilha", "id": "saldo"},
                        ],
                        data=[],
                        sort_action="native",
                        page_size=15,
                        **creditos_table_styles,
                    ),
                ],
            ),
            html.Div(
                className="card-block",
                children=[
                    html.Div(
                        className="card-header",
                        children=[
                            html.Span(
                                "Detalhamento por natureza de despesa",
                                className="card-title",
                            ),
                            html.Span(
                                "Mostra a composição do crédito disponível por item de informação.",
                                className="card-subtitle",
                            ),
                            html.Span(
                                "Detalhamento prioriza crédito disponível.",
                                id="creditos-natureza-caption",
                                className="card-subtitle hint-text",
                            ),
                        ],
                    ),
                    dash_table.DataTable(
                        id="tabela-creditos-natureza",
                        columns=[
                            {"name": "Unidade", "id": "unidade"},
                            {"name": "Categoria", "id": "categoria_pi"},
                            {"name": "Item informação", "id": "item_informacao"},
                            {"name": "Natureza da despesa", "id": "descricao_natureza"},
                            {"name": "Crédito disponível", "id": "credito_disponivel"},
                        ],
                        data=[],
                        sort_action="native",
                        page_size=15,
                        **natureza_table_styles,
                    ),
                ],
            ),
        ],
    )


app = Dash(
    __name__,
    suppress_callback_exceptions=True,
    requests_pathname_prefix=CAOR_BASE_PATH,
)
app.title = "Dashboard CAOR - Matriz e Créditos Próprios"
server = app.server

app.layout = html.Div(
    [
        dcc.Location(id="url"),
        dcc.Store(id="matriz-refresh-token", data=0),
        dcc.Store(id="creditos-refresh-token", data=0),
        dcc.Store(id="matriz-selection", data=None),
        dcc.Store(id="creditos-selection", data=None),
        dcc.Store(id="matriz-focus", data=None),
        dcc.Store(id="creditos-focus", data=None),
        html.Div(
            className="layout",
            children=[
                html.Aside(
                    className="sidebar",
                    children=[
                        html.Div(
                            className="sidebar-logo",
                            children=[
                                html.Div(className="logo-mark", children="CA"),
                                html.Div(
                                    className="logo-text",
                                    children=[
                                        html.Span("CAOR", className="logo-title"),
                                        html.Span(
                                            "Gestão Orçamentária",
                                            className="logo-subtitle",
                                        ),
                                    ],
                                ),
                            ],
                        ),
                        html.Div(
                            className="sidebar-section",
                            children=[
                                html.Span("📊 Painéis", className="sidebar-section-title"),
                                dcc.Link(
                                    "Matriz das Unidades",
                                    id="nav-matriz",
                                    className="sidebar-link",
                                    href="/matriz",
                                ),
                                dcc.Link(
                                    "Créditos Próprios",
                                    id="nav-creditos",
                                    className="sidebar-link",
                                    href="/creditos",
                                ),
                            ],
                        ),
                        html.Div(
                            className="sidebar-footer",
                            children=[
                                html.Span("PTRES 230639", className="sidebar-footer-label"),
                                html.Small(
                                    "Dados integrados - Matriz & Créditos",
                                    className="sidebar-footer-text",
                                ),
                            ],
                        ),
                    ],
                ),
                html.Div(
                    className="main-area",
                    children=[
                        html.Div(
                            id="topbar",
                            className="topbar",
                            children=[
                                html.Div(
                                    className="topbar-left",
                                    children=[
                                        html.H2(
                                            id="topbar-title",
                                            className="topbar-title",
                                            children="Matriz das Unidades",
                                        ),
                                        html.Span(
                                            "Universidade de Brasília · CAOR",
                                            className="topbar-subtitle",
                                        ),
                                    ],
                                ),
                                html.Div(
                                    className="topbar-actions",
                                    children=[
                                        html.A(
                                            "Sair do portal",
                                            href="/",
                                            className="topbar-exit",
                                        ),
                                    ],
                                ),
                            ],
                        ),
                        html.Div(id="page-container", className="page-container"),
                    ],
                ),
            ],
        ),
    ]
)

app.validation_layout = html.Div([
    dcc.Location(id="url"),
    dcc.Store(id="matriz-refresh-token"),
    dcc.Store(id="creditos-refresh-token"),
    dcc.Store(id="matriz-selection"),
    dcc.Store(id="creditos-selection"),
    dcc.Store(id="matriz-focus"),
    dcc.Store(id="creditos-focus"),
    render_matriz_page(),
    render_creditos_page(),
])


@app.callback(
    Output("page-container", "children"),
    Output("topbar-title", "children"),
    Input("url", "pathname"),
)
def atualizar_pagina(pathname: Optional[str]):
    if not pathname or pathname == "/":
        pathname = "/matriz"

    if pathname == "/matriz":
        return render_matriz_page(), "Matriz das Unidades"
    if pathname == "/creditos":
        return render_creditos_page(), "Créditos Próprios"

    return render_matriz_page(), "Matriz das Unidades"


@app.callback(
    Output("nav-matriz", "className"),
    Output("nav-creditos", "className"),
    Input("url", "pathname"),
)
def destacar_menu(pathname: Optional[str]):
    base_class = "sidebar-link"
    if not pathname or pathname == "/":
        pathname = "/matriz"

    matriz_class = f"{base_class} active" if pathname == "/matriz" else base_class
    creditos_class = f"{base_class} active" if pathname == "/creditos" else base_class
    return matriz_class, creditos_class


@app.callback(
    Output("upload-matriz-status", "children"),
    Output("matriz-refresh-token", "data"),
    Input("upload-matriz", "contents"),
    State("upload-matriz", "filename"),
    prevent_initial_call=True,
)
def tratar_upload_matriz(contents: Optional[str], filename: Optional[str]):
    if not contents:
        raise PreventUpdate
    try:
        save_uploaded_excel(contents, "Tabela Aprovado - Copia (2).xlsx")
        refresh_global_datasets()
        token = f"matriz-{pd.Timestamp.utcnow().isoformat()}"
        status = html.Span(
            f"Planilha '{filename or 'matriz'}' atualizada com sucesso.",
            className="upload-status-success",
        )
        return status, token
    except Exception as exc:
        status = html.Span(
            f"Erro ao atualizar matriz: {exc}", className="upload-status-error"
        )
        return status, no_update


@app.callback(
    Output("upload-creditos-status", "children"),
    Output("creditos-refresh-token", "data"),
    Input("upload-creditos", "contents"),
    State("upload-creditos", "filename"),
    prevent_initial_call=True,
)
def tratar_upload_creditos(contents: Optional[str], filename: Optional[str]):
    if not contents:
        raise PreventUpdate
    try:
        save_uploaded_excel(contents, "Credito disponível e valor empenhado.xlsx")
        refresh_global_datasets()
        token = f"creditos-{pd.Timestamp.utcnow().isoformat()}"
        status = html.Span(
            f"Planilha '{filename or 'créditos'}' atualizada com sucesso.",
            className="upload-status-success",
        )
        return status, token
    except Exception as exc:
        status = html.Span(
            f"Erro ao atualizar créditos: {exc}", className="upload-status-error"
        )
        return status, no_update


@app.callback(
    Output("matriz-selection", "data"),
    Input("matriz-refresh-token", "data"),
    Input("grafico-matriz", "clickData"),
    Input("grafico-matriz-estrutura", "clickData"),
    Input("grafico-matriz-execucao", "clickData"),
    Input("btn-clear-matriz", "n_clicks"),
    prevent_initial_call=True,
)
def atualizar_selecao_matriz(token, click_barras, click_estrutura, click_execucao, clear_clicks):
    triggered_id = ctx.triggered_id
    if triggered_id is None:
        raise PreventUpdate
    trigger = str(triggered_id)

    if trigger == "btn-clear-matriz":
        return None

    if trigger == "matriz-refresh-token":
        return None

    if trigger == "grafico-matriz" and click_barras:
        unit = click_barras["points"][0].get("x")
        return {"unidade": unit}

    if trigger == "grafico-matriz-execucao" and click_execucao:
        unit = click_execucao["points"][0].get("x")
        return {"unidade": unit}

    if trigger == "grafico-matriz-estrutura" and click_estrutura:
        point = click_estrutura["points"][0]
        if point.get("customdata"):
            pi_bruto = point["customdata"][0]
            if pi_bruto is not None and not pd.isna(pi_bruto):
                return {"pi": str(pi_bruto)}
        pi_label = point.get("y") or point.get("x")
        if pi_label and pi_label != "PI não informado":
            return {"pi": pi_label}

    raise PreventUpdate


@app.callback(
    Output("creditos-selection", "data"),
    Input("grafico-creditos-categoria", "clickData"),
    Input("grafico-creditos-vs-despesas", "clickData"),
    Input("grafico-creditos-pizza", "clickData"),
    Input("btn-clear-creditos", "n_clicks"),
    prevent_initial_call=True,
)
def atualizar_selecao_creditos(click_cat, click_bar, click_pizza, clear_clicks):
    triggered_id = ctx.triggered_id
    if triggered_id is None:
        raise PreventUpdate
    trigger = str(triggered_id)

    if trigger == "btn-clear-creditos":
        return None

    if trigger == "grafico-creditos-categoria" and click_cat:
        point = click_cat["points"][0]
        unidade = point.get("x") or point.get("label")
        categoria = point.get("customdata")[0] if point.get("customdata") else point.get("name")
        data = {}
        if unidade:
            data["unidade"] = unidade
        if categoria:
            data["categoria"] = categoria
        return data or None

    if trigger == "grafico-creditos-vs-despesas" and click_bar:
        point = click_bar["points"][0]
        unidade = point.get("x")
        indicador = point.get("customdata")[0] if point.get("customdata") else point.get("curveNumber")
        data = {"unidade": unidade}
        if isinstance(indicador, str):
            data["indicador"] = indicador
        return data

    if trigger == "grafico-creditos-pizza" and click_pizza:
        point = click_pizza["points"][0]
        categoria = None
        if point.get("customdata"):
            categoria = point["customdata"][0]
        if not categoria:
            categoria = point.get("x") or point.get("y") or point.get("label")
        if categoria:
            return {"categoria": categoria}

    raise PreventUpdate


@app.callback(
    Output("matriz-focus", "data"),
    Input("btn-kpi-matriz-total-aprovado", "n_clicks"),
    Input("btn-kpi-matriz-credito-disponivel", "n_clicks"),
    Input("btn-kpi-matriz-empenhado", "n_clicks"),
    Input("btn-kpi-matriz-debitos", "n_clicks"),
    Input("btn-kpi-matriz-total-executado", "n_clicks"),
    Input("btn-kpi-matriz-saldo", "n_clicks"),
    Input("btn-kpi-matriz-pct-execucao", "n_clicks"),
    Input("btn-clear-matriz", "n_clicks"),
    Input("matriz-refresh-token", "data"),
    prevent_initial_call=True,
)
def atualizar_foco_matriz(*_):
    triggered_id = ctx.triggered_id
    if triggered_id is None:
        raise PreventUpdate
    trigger = str(triggered_id)
    if trigger in ("btn-clear-matriz", "matriz-refresh-token"):
        return None
    metric = MATRIZ_KPI_MAP.get(trigger)
    if metric:
        return metric
    raise PreventUpdate


@app.callback(
    Output("creditos-focus", "data"),
    Input("btn-kpi-creditos-total", "n_clicks"),
    Input("btn-kpi-creditos-academica", "n_clicks"),
    Input("btn-kpi-creditos-administrativa", "n_clicks"),
    Input("btn-kpi-creditos-demais", "n_clicks"),
    Input("btn-kpi-creditos-despesas", "n_clicks"),
    Input("btn-kpi-creditos-percentual", "n_clicks"),
    Input("btn-clear-creditos", "n_clicks"),
    Input("creditos-refresh-token", "data"),
    prevent_initial_call=True,
)
def atualizar_foco_creditos(*_):
    triggered_id = ctx.triggered_id
    if triggered_id is None:
        raise PreventUpdate
    trigger = str(triggered_id)
    if trigger in ("btn-clear-creditos", "creditos-refresh-token"):
        return None
    metric = CREDITOS_KPI_MAP.get(trigger)
    if metric:
        return metric
    raise PreventUpdate


@app.callback(
    output=[
        Output("matriz-unidades", "options"),
        Output("matriz-pi", "options"),
        Output("kpi-total-aprovado", "children"),
        Output("kpi-credito-disponivel", "children"),
        Output("kpi-empenhado", "children"),
        Output("kpi-debitos", "children"),
        Output("kpi-total-executado", "children"),
        Output("kpi-saldo", "children"),
        Output("kpi-pct-execucao", "children"),
        Output("matriz-alertas", "children"),
        Output("matriz-highlight", "children"),
        Output("matriz-table-caption", "children"),
        Output("matriz-detalhe-caption", "children"),
        Output("grafico-matriz", "figure"),
        Output("grafico-matriz-estrutura", "figure"),
        Output("grafico-matriz-execucao", "figure"),
        Output("tabela-matriz", "data"),
        Output("tabela-matriz-detalhe", "data"),
    ],
    inputs=[
        Input("matriz-refresh-token", "data"),
        Input("creditos-refresh-token", "data"),
        Input("matriz-selection", "data"),
        Input("matriz-unidades", "value"),
        Input("matriz-pi", "value"),
        Input("matriz-focus", "data"),
    ],
)
def atualizar_matriz(
    _matriz_token: Optional[str],
    _creditos_token: Optional[str],
    selection: Optional[dict],
    unidades: Optional[List[str]],
    pi_valores: Optional[List[str]],
    focus_metric: Optional[str],
):
    unidades = unidades or []
    pi_valores = pi_valores or []
    selection = selection or {}
    focus_metric = focus_metric or MATRIZ_DEFAULT_METRIC
    if focus_metric not in MATRIZ_KPI_LABELS:
        focus_metric = MATRIZ_DEFAULT_METRIC
    focus_label = MATRIZ_KPI_LABELS.get(focus_metric, MATRIZ_KPI_LABELS[MATRIZ_DEFAULT_METRIC])
    tabela_caption = "Sem dados para ordenar."
    detalhe_caption = "Sem detalhes disponíveis."

    filtrado = filter_dataframe(MATRIZ_DF, unidades, pi_valores)
    agrupado, totais = build_matriz_summary(filtrado)

    kpis = (
        format_currency(totais["total_aprovado"]),
        format_currency(totais["credito_disponivel"]),
        format_currency(totais["empenhado"]),
        format_currency(totais["debitos"]),
        format_currency(totais["total_executado"]),
        format_currency(totais["saldo"]),
        format_percent(totais["pct_execucao"]),
    )

    def _empty_fig(message: str):
        fig = px.bar()
        fig.update_layout(
            template="plotly_white",
            plot_bgcolor="rgba(255,255,255,0)",
            paper_bgcolor="rgba(255,255,255,0)",
            xaxis=dict(visible=False),
            yaxis=dict(visible=False),
            annotations=[
                dict(text=message, showarrow=False, font=dict(color="#475569", size=14))
            ],
        )
        return fig

    alertas_component = html.Ul([html.Li("Nenhum dado para alertas com os filtros atuais.")])
    figura = _empty_fig("Nenhum dado disponível para os filtros selecionados.")
    fig_estrutura = _empty_fig("Sem composição disponível.")
    fig_execucao = _empty_fig("Sem dados de execução disponíveis.")
    tabela: list[Dict[str, str]] = []
    detalhe_records: list[Dict[str, str]] = []
    destaque = [
        html.Span("Nenhum dado filtrado", className="insight-title"),
        html.P(
            "Selecione ao menos uma unidade ou PI para visualizar os indicadores.",
            className="insight-text",
        ),
    ]

    if not agrupado.empty:
        order_metric = focus_metric if focus_metric in agrupado.columns else MATRIZ_DEFAULT_METRIC
        display_df = agrupado.sort_values(order_metric, ascending=False).head(12)
        chart_df = display_df.rename(
            columns={
                "credito_disponivel": "Crédito disponível",
                "empenhado": "Empenhado",
            }
        )
        grafico_df = chart_df.melt(
            id_vars="unidade",
            value_vars=["Crédito disponível", "Empenhado"],
            var_name="Indicador",
            value_name="Valor",
        )
        figura = px.bar(
            grafico_df,
            x="unidade",
            y="Valor",
            color="Indicador",
            barmode="group",
            color_discrete_map={
                "Crédito disponível": PRIMARY_COLOR,
                "Empenhado": EMPHASIS_COLOR,
            },
            custom_data=["Indicador"],
        )
        category_array = display_df["unidade"].tolist()
        figura.update_layout(
            template="plotly_white",
            plot_bgcolor="rgba(255,255,255,0)",
            paper_bgcolor="rgba(255,255,255,0)",
            margin=dict(t=30, l=20, r=20, b=40),
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1, title=""),
            xaxis=dict(
                title=None,
                categoryorder="array",
                categoryarray=category_array,
                tickangle=-25,
            ),
            yaxis=dict(
                title="Valor (R$)",
                tickprefix="R$ ",
                gridcolor="rgba(148, 163, 184, 0.35)",
                zeroline=False,
            ),
            transition={"duration": 500, "easing": "cubic-in-out"},
        )
        figura.update_traces(
            marker_line_color="rgba(15, 23, 42, 0.14)",
            marker_line_width=1.2,
            hovertemplate="<b>%{x}</b><br>%{customdata[0]}: R$ %{y:,.2f}<extra></extra>",
            opacity=0.92,
            texttemplate="R$ %{y:,.0f}",
            textposition="outside",
            cliponaxis=False,
        )
        tabela_caption = f"Ordenado por {focus_label}."
        detalhe_caption = f"Detalhamento prioriza {focus_label}."

        negativos = agrupado[agrupado["saldo"] < 0]
        exec_acima = agrupado[agrupado["pct_execucao"] > 1]
        baixa_exec = agrupado[agrupado["pct_execucao"] < 0.3]
        alertas_items = []
        if not negativos.empty:
            alertas_items.append(
                html.Li(
                    [
                        html.Strong(f"{len(negativos)} unidades"),
                        " com saldo negativo somando ",
                        format_currency(negativos["saldo"].sum()),
                    ]
                )
            )
        if not exec_acima.empty:
            top_pct = exec_acima.sort_values("pct_execucao", ascending=False).iloc[0]
            alertas_items.append(
                html.Li(
                    [
                        html.Strong(top_pct["unidade"]),
                        " executou ",
                        format_percent(top_pct["pct_execucao"]),
                        " do aprovado.",
                    ]
                )
            )
        if not baixa_exec.empty:
            lista_baixa = ", ".join(baixa_exec.sort_values("pct_execucao")["unidade"].head(3))
            alertas_items.append(html.Li(["Execução abaixo de 30% em: ", lista_baixa or "-"]))
        if alertas_items:
            alertas_component = html.Ul(alertas_items)

        estrutura_df = (
            filtrado.groupby("pi", as_index=False)[
                ["credito_disponivel", "total_aprovado", "empenhado"]
            ]
            .sum()
        )
        if not estrutura_df.empty:
            estrutura_df["pi_label"] = estrutura_df["pi"].fillna("PI não informado")
            estrutura_metric = focus_metric if focus_metric in estrutura_df.columns else "credito_disponivel"
            display_estrutura = estrutura_df.sort_values(
                estrutura_metric, ascending=False
            ).head(20)
            fig_estrutura = px.bar(
                display_estrutura,
                x="pi_label",
                y="credito_disponivel",
                labels={"credito_disponivel": "Crédito disponível", "pi_label": "PI"},
                color_discrete_sequence=[SECONDARY_COLOR],
                custom_data=["pi", "total_aprovado", "empenhado"],
            )
            fig_estrutura.update_layout(
                template="plotly_white",
                plot_bgcolor="rgba(255,255,255,0)",
                paper_bgcolor="rgba(255,255,255,0)",
                margin=dict(t=30, l=20, r=20, b=40),
                xaxis=dict(title=None, tickangle=-20, categoryorder="array", categoryarray=display_estrutura["pi_label"].tolist(), automargin=True),
                yaxis=dict(
                    title="Crédito disponível (R$)",
                    tickprefix="R$ ",
                    gridcolor="rgba(148, 163, 184, 0.35)",
                    zeroline=False,
                ),
                transition={"duration": 500, "easing": "cubic-in-out"},
            )
            fig_estrutura.update_traces(
                hovertemplate="<b>%{x}</b><br>Crédito disponível: R$ %{y:,.2f}<br>Total aprovado: R$ %{customdata[1]:,.2f}<br>Empenhado: R$ %{customdata[2]:,.2f}<extra></extra>",
                marker_line_color="rgba(15, 23, 42, 0.12)",
                marker_line_width=1.1,
                texttemplate="R$ %{y:,.0f}",
                textposition="outside",
                cliponaxis=False,
            )

        exec_df = agrupado.assign(exec_percent=agrupado["pct_execucao"].fillna(0) * 100)
        exec_top = exec_df.sort_values("exec_percent", ascending=False).head(10)
        exec_low = exec_df.sort_values("exec_percent", ascending=True).head(5)
        exec_plot = pd.concat([exec_top, exec_low]).drop_duplicates("unidade")
        if not exec_plot.empty:
            fig_execucao = px.bar(
                exec_plot,
                x="unidade",
                y="exec_percent",
                color="saldo",
                color_continuous_scale=px.colors.sequential.Blues,
                labels={"exec_percent": "% Execução", "unidade": "Unidade", "saldo": "Saldo"},
            )
            fig_execucao.update_layout(
                template="plotly_white",
                plot_bgcolor="rgba(255,255,255,0)",
                paper_bgcolor="rgba(255,255,255,0)",
                margin=dict(t=30, l=20, r=20, b=40),
                coloraxis_showscale=False,
                xaxis=dict(title=None, categoryorder="array", categoryarray=exec_plot["unidade"].tolist(), tickangle=-25),
                yaxis=dict(title="% Execução", gridcolor="rgba(148, 163, 184, 0.35)", zeroline=False),
                transition={"duration": 500, "easing": "cubic-in-out"},
            )
            fig_execucao.update_traces(
                hovertemplate="<b>%{x}</b><br>% Execução: %{y:.1f}%<br>Saldo: R$ %{marker.color:,.2f}<extra></extra>",
                texttemplate="%{y:.1f}%",
                textposition="outside",
                cliponaxis=False,
            )

        destaque_itens = []
        top_credit = agrupado.sort_values("credito_disponivel", ascending=False).iloc[0]
        destaque_itens.append(
            html.Li(
                [
                    html.Strong(top_credit["unidade"]),
                    " concentra ",
                    format_currency(top_credit["credito_disponivel"]),
                    " em crédito disponível.",
                ],
                className="insight-item",
            )
        )
        pct_series = agrupado["pct_execucao"].dropna()
        if not pct_series.empty:
            top_pct = agrupado.loc[pct_series.idxmax()]
            destaque_itens.append(
                html.Li(
                    [
                        "Maior execução relativa em ",
                        html.Strong(top_pct["unidade"]),
                        ": ",
                        format_percent(top_pct["pct_execucao"]),
                        " do aprovado.",
                    ],
                    className="insight-item",
                )
            )
        saldo_series = agrupado["saldo"].dropna()
        if not saldo_series.empty:
            menor_saldo = agrupado.loc[saldo_series.idxmin()]
            if menor_saldo["saldo"] < 0:
                destaque_itens.append(
                    html.Li(
                        [
                            html.Strong(menor_saldo["unidade"]),
                            " apresenta saldo negativo de ",
                            format_currency(menor_saldo["saldo"]),
                            ".",
                        ],
                        className="insight-item warning",
                    )
                )
        destaque = [
            html.Span("Destaques automáticos", className="insight-title"),
            html.Ul(destaque_itens, className="insight-list"),
        ]

        tabela_df = agrupado.sort_values(order_metric, ascending=False).copy()
        tabela_df["total_aprovado"] = tabela_df["total_aprovado"].apply(format_currency)
        tabela_df["credito_disponivel"] = tabela_df["credito_disponivel"].apply(format_currency)
        tabela_df["empenhado"] = tabela_df["empenhado"].apply(format_currency)
        tabela_df["debitos"] = tabela_df["debitos"].apply(format_currency)
        tabela_df["saldo"] = tabela_df["saldo"].apply(format_currency)
        tabela_df["pct_execucao"] = tabela_df["pct_execucao"].apply(format_percent)
        tabela_df["pct_empenhado_credito"] = tabela_df["pct_empenhado_credito"].apply(format_percent)
        tabela = tabela_df.to_dict("records")

        detalhe_df = filtrado.copy()
        if selection.get("unidade"):
            detalhe_df = detalhe_df[detalhe_df["unidade"] == selection["unidade"]]
        if selection.get("pi"):
            detalhe_df = detalhe_df[detalhe_df["pi"] == selection["pi"]]

        if not detalhe_df.empty:
            detalhe_df = detalhe_df.assign(
                saldo=detalhe_df["credito_disponivel"] - detalhe_df["empenhado"],
                pct_execucao=detalhe_df["empenhado"] / detalhe_df["total_aprovado"],
            )
            detalhe_metric = focus_metric if focus_metric in detalhe_df.columns else MATRIZ_DEFAULT_METRIC
            detalhe_df = detalhe_df.sort_values(detalhe_metric, ascending=False).head(50)
            detalhe_fmt = detalhe_df.copy()
            for col in [
                "total_aprovado",
                "credito_disponivel",
                "empenhado",
                "debitos",
                "saldo",
            ]:
                detalhe_fmt[col] = detalhe_fmt[col].apply(format_currency)
            detalhe_fmt["pct_execucao"] = detalhe_fmt["pct_execucao"].apply(format_percent)
            detalhe_records = detalhe_fmt[
                [
                    "unidade",
                    "pi",
                    "total_aprovado",
                    "credito_disponivel",
                    "empenhado",
                    "debitos",
                    "saldo",
                    "pct_execucao",
                ]
            ].to_dict("records")

    return (
        UNIDADE_OPTIONS,
        PI_OPTIONS,
        *kpis,
        alertas_component,
        destaque,
        tabela_caption,
        detalhe_caption,
        figura,
        fig_estrutura,
        fig_execucao,
        tabela,
        detalhe_records,
    )


@app.callback(
    output=[
        Output("creditos-unidades", "options"),
        Output("creditos-categorias", "options"),
        Output("kpi-creditos-total", "children"),
        Output("kpi-creditos-matriz-academica", "children"),
        Output("kpi-creditos-matriz-administrativa", "children"),
        Output("kpi-creditos-demais", "children"),
        Output("kpi-creditos-despesas", "children"),
        Output("kpi-creditos-percentual-empenhado", "children"),
        Output("creditos-alertas", "children"),
        Output("creditos-highlight", "children"),
        Output("creditos-table-caption", "children"),
        Output("creditos-natureza-caption", "children"),
        Output("grafico-creditos-categoria", "figure"),
        Output("grafico-creditos-vs-despesas", "figure"),
        Output("grafico-creditos-pizza", "figure"),
        Output("tabela-creditos", "data"),
        Output("tabela-creditos-natureza", "data"),
    ],
    inputs=[
        Input("matriz-refresh-token", "data"),
        Input("creditos-refresh-token", "data"),
        Input("creditos-selection", "data"),
        Input("creditos-unidades", "value"),
        Input("creditos-categorias", "value"),
        Input("creditos-focus", "data"),
    ],
)
def atualizar_creditos(
    _matriz_token: Optional[str],
    _creditos_token: Optional[str],
    selection: Optional[dict],
    unidades: Optional[List[str]],
    categorias: Optional[List[str]],
    focus_metric: Optional[str],
):
    unidades = unidades or []
    categorias = categorias or []
    selection = selection or {}
    focus_metric = focus_metric or CREDITOS_DEFAULT_METRIC
    if focus_metric not in CREDITOS_KPI_LABELS:
        focus_metric = CREDITOS_DEFAULT_METRIC
    focus_label = CREDITOS_KPI_LABELS.get(
        focus_metric, CREDITOS_KPI_LABELS[CREDITOS_DEFAULT_METRIC]
    )
    tabela_caption = "Sem dados para ordenar."
    natureza_caption = "Sem detalhes disponíveis."

    resumo, totais, natureza = build_creditos_summary(
        CREDITOS_CATEGORIA_DF, CREDITO_DETALHADO_DF, CONRAZAO_DF, unidades, categorias
    )

    kpis = (
        format_currency(totais["total_credito"]),
        format_currency(totais["matriz_academica"]),
        format_currency(totais["matriz_administrativa"]),
        format_currency(totais["demais_creditos"]),
        format_currency(totais["despesas"]),
        format_percent(totais["pct_credito_empenhado"]),
    )

    def _empty_fig(message: str):
        fig = px.bar()
        fig.update_layout(
            template="plotly_white",
            plot_bgcolor="rgba(255,255,255,0)",
            paper_bgcolor="rgba(255,255,255,0)",
            xaxis=dict(visible=False),
            yaxis=dict(visible=False),
            annotations=[
                dict(text=message, showarrow=False, font=dict(color="#475569", size=14))
            ],
        )
        return fig

    alertas_component = html.Ul([html.Li("Nenhum alerta para os filtros atuais.")])
    figura_categoria = _empty_fig("Nenhum dado disponível para os filtros selecionados.")
    figura_despesas = _empty_fig("Sem dados de comparação disponíveis.")
    figura_pizza = _empty_fig("Sem composição disponível.")
    tabela_resumo: list[Dict[str, str]] = []
    tabela_natureza: list[Dict[str, str]] = []
    destaque = [
        html.Span("Nenhum crédito encontrado", className="insight-title"),
        html.P(
            "Ajuste os filtros para visualizar a distribuição dos créditos próprios.",
            className="insight-text",
        ),
    ]

    if not resumo.empty:
        categoria_lookup = {
            "Matriz Acadêmica": "Matriz Acadêmica (MGY01N0104N)",
            "Matriz Administrativa": "Matriz Administrativa (VGY01N0105N)",
            "Demais créditos": "Demais créditos PTRES 230639",
        }

        resumo_exibicao = resumo.copy()
        sel_unidade = selection.get("unidade")
        sel_categoria = selection.get("categoria")
        if sel_unidade:
            resumo_exibicao = resumo_exibicao[resumo_exibicao["unidade"] == sel_unidade]
        if sel_categoria and sel_categoria in categoria_lookup:
            col = categoria_lookup[sel_categoria]
            resumo_exibicao = resumo_exibicao[resumo_exibicao[col] > 0]

        display_resumo = resumo_exibicao.head(12).copy() if not resumo_exibicao.empty else resumo.head(12).copy()

        categoria_label_map = {
            "Matriz Acadêmica (MGY01N0104N)": "Matriz Acadêmica",
            "Matriz Administrativa (VGY01N0105N)": "Matriz Administrativa",
            "Demais créditos PTRES 230639": "Demais créditos",
        }
        order_metric_resumo = focus_metric if focus_metric in display_resumo.columns else CREDITOS_DEFAULT_METRIC
        if order_metric_resumo not in display_resumo.columns:
            order_metric_resumo = CREDITOS_DEFAULT_METRIC
        display_resumo = display_resumo.sort_values(order_metric_resumo, ascending=False)
        tabela_caption = f"Ordenado por {focus_label}."
        natureza_caption = f"Detalhamento prioriza {focus_label}."
        chart_categoria = display_resumo.rename(columns=categoria_label_map)
        grafico_categoria_df = chart_categoria.melt(
            id_vars="unidade",
            value_vars=list(categoria_label_map.values()),
            var_name="Categoria",
            value_name="Valor",
        )
        figura_categoria = px.bar(
            grafico_categoria_df,
            x="unidade",
            y="Valor",
            color="Categoria",
            color_discrete_map=CATEGORIA_COLOR_MAP,
            custom_data=["Categoria"],
        )
        figura_categoria.update_layout(
            template="plotly_white",
            plot_bgcolor="rgba(255,255,255,0)",
            paper_bgcolor="rgba(255,255,255,0)",
            barmode="stack",
            margin=dict(t=30, l=20, r=20, b=40),
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1, title=""),
            xaxis=dict(title=None, tickangle=-25, categoryorder="array", categoryarray=display_resumo["unidade"].tolist()),
            yaxis=dict(title="Valor (R$)", tickprefix="R$ ", gridcolor="rgba(148, 163, 184, 0.35)", zeroline=False),
            transition={"duration": 500, "easing": "cubic-in-out"},
        )
        figura_categoria.update_traces(
            hovertemplate="<b>%{x}</b><br>%{customdata[0]}: R$ %{y:,.2f}<extra></extra>",
        )

        grafico_comparativo_df = display_resumo[
            ["unidade", "total_credito_ptres_230639", "despesas_empenhadas", "diferenca_credito"]
        ].rename(
            columns={
                "total_credito_ptres_230639": "Crédito PTRES 230639",
                "despesas_empenhadas": "Despesas empenhadas",
                "diferenca_credito": "Gap (PTRES - planilha)",
            }
        )
        figura_despesas = px.bar(
            grafico_comparativo_df.melt(id_vars="unidade", var_name="Indicador", value_name="Valor"),
            x="unidade",
            y="Valor",
            color="Indicador",
            barmode="group",
            color_discrete_map={
                "Crédito PTRES 230639": PRIMARY_COLOR,
                "Despesas empenhadas": ACCENT_COLOR,
                "Gap (PTRES - planilha)": "#ef4444",
            },
            custom_data=["Indicador"],
        )
        figura_despesas.update_layout(
            template="plotly_white",
            plot_bgcolor="rgba(255,255,255,0)",
            paper_bgcolor="rgba(255,255,255,0)",
            margin=dict(t=30, l=20, r=20, b=40),
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1, title=""),
            xaxis=dict(title=None, categoryorder="array", categoryarray=display_resumo["unidade"].tolist(), tickangle=-25),
            yaxis=dict(title="Valor (R$)", tickprefix="R$ ", gridcolor="rgba(148, 163, 184, 0.35)", zeroline=False),
            transition={"duration": 500, "easing": "cubic-in-out"},
        )
        figura_despesas.update_traces(
            marker_line_color="rgba(15, 23, 42, 0.14)",
            marker_line_width=1.2,
            hovertemplate="<b>%{x}</b><br>%{customdata[0]}: R$ %{y:,.2f}<extra></extra>",
            texttemplate="R$ %{y:,.0f}",
            textposition="outside",
            cliponaxis=False,
        )

        categoria_data = pd.DataFrame(
            {
                "Categoria": ["Matriz Acadêmica", "Matriz Administrativa", "Demais créditos"],
                "Valor": [
                    totais["matriz_academica"],
                    totais["matriz_administrativa"],
                    totais["demais_creditos"],
                ],
            }
        )
        categoria_data = categoria_data.sort_values("Valor", ascending=True)
        figura_pizza = px.bar(
            categoria_data,
            x="Categoria",
            y="Valor",
            color="Categoria",
            color_discrete_map=CATEGORIA_COLOR_MAP,
            custom_data=["Categoria"],
        )
        figura_pizza.update_layout(
            template="plotly_white",
            plot_bgcolor="rgba(255,255,255,0)",
            paper_bgcolor="rgba(255,255,255,0)",
            margin=dict(t=30, l=20, r=20, b=40),
            showlegend=False,
            xaxis=dict(title=None, tickangle=-15, categoryorder="array", categoryarray=categoria_data["Categoria"].tolist()),
            yaxis=dict(
                title="Valor (R$)",
                tickprefix="R$ ",
                gridcolor="rgba(148, 163, 184, 0.35)",
                zeroline=False,
            ),
            transition={"duration": 500, "easing": "cubic-in-out"},
        )
        figura_pizza.update_traces(
            hovertemplate="<b>%{x}</b><br>Valor: R$ %{y:,.2f}<extra></extra>",
            texttemplate="R$ %{y:,.0f}",
            textposition="outside",
            cliponaxis=False,
        )

        # Alertas
        alertas_items = []
        gaps_altos = resumo[resumo["diferenca_credito"].abs() > resumo["total_credito_ptres_230639"] * 0.1]
        if not gaps_altos.empty:
            maior_gap = gaps_altos.sort_values("diferenca_credito", key=abs, ascending=False).iloc[0]
            alertas_items.append(
                html.Li(
                    [
                        html.Strong(maior_gap["unidade"]),
                        " possui gap de ",
                        format_currency(maior_gap["diferenca_credito"]),
                        " entre o PTRES e a planilha.",
                    ]
                )
            )
        baixa_exec = resumo[(resumo["despesas_empenhadas"] / resumo["total_credito_ptres_230639"].replace(0, pd.NA)) < 0.3]
        baixa_exec = baixa_exec.dropna(subset=["despesas_empenhadas", "total_credito_ptres_230639"])
        if not baixa_exec.empty:
            lista = ", ".join(baixa_exec.sort_values("despesas_empenhadas")["unidade"].head(3))
            alertas_items.append(html.Li(["Execução abaixo de 30% em: ", lista or "-"]))
        if alertas_items:
            alertas_component = html.Ul(alertas_items)

        destaque_itens = []
        top_credit = resumo.sort_values("total_credito_ptres_230639", ascending=False).iloc[0]
        destaque_itens.append(
            html.Li(
                [
                    html.Strong(top_credit["unidade"]),
                    " lidera com ",
                    format_currency(top_credit["total_credito_ptres_230639"]),
                    " em créditos próprios.",
                ],
                className="insight-item",
            )
        )
        gap_series = resumo["diferenca_credito"].abs()
        if not gap_series.empty:
            gap_unit = resumo.loc[gap_series.idxmax()]
            destaque_itens.append(
                html.Li(
                    [
                        "Maior diferença entre consolidado e planilha em ",
                        html.Strong(gap_unit["unidade"]),
                        ": ",
                        format_currency(gap_unit["diferenca_credito"]),
                        ".",
                    ],
                    className="insight-item",
                )
            )
        if totais["total_credito"]:
            share_academica = totais["matriz_academica"] / totais["total_credito"]
            destaque_itens.append(
                html.Li(
                    [
                        "A matriz acadêmica representa ",
                        format_percent(share_academica),
                        " do crédito total do PTRES 230639.",
                    ],
                    className="insight-item",
                )
            )
        destaque = [
            html.Span("Destaques automáticos", className="insight-title"),
            html.Ul(destaque_itens, className="insight-list"),
        ]

        # Tabela resumo formatada
        resumo_fmt = resumo.copy()
        if sel_unidade:
            resumo_fmt = resumo_fmt[resumo_fmt["unidade"] == sel_unidade]
        if sel_categoria and sel_categoria in CATEGORIA_COLOR_MAP:
            col = {
                "Matriz Acadêmica": "Matriz Acadêmica (MGY01N0104N)",
                "Matriz Administrativa": "Matriz Administrativa (VGY01N0105N)",
                "Demais créditos": "Demais créditos PTRES 230639",
            }[sel_categoria]
            resumo_fmt = resumo_fmt[resumo_fmt[col] > 0]
        order_metric_fmt = focus_metric if focus_metric in resumo_fmt.columns else CREDITOS_DEFAULT_METRIC
        if order_metric_fmt not in resumo_fmt.columns:
            order_metric_fmt = CREDITOS_DEFAULT_METRIC
        resumo_fmt = resumo_fmt.sort_values(order_metric_fmt, ascending=False)
        tabela_df = resumo_fmt[
            [
                "unidade",
                "Matriz Acadêmica (MGY01N0104N)",
                "Matriz Administrativa (VGY01N0105N)",
                "Demais créditos PTRES 230639",
                "total_credito_ptres_230639",
                "diferenca_credito",
                "credito_disponivel",
                "despesas_empenhadas",
                "saldo",
            ]
        ].copy()
        for coluna in tabela_df.columns:
            if coluna != "unidade":
                tabela_df[coluna] = tabela_df[coluna].apply(format_currency)
        tabela_resumo = tabela_df.to_dict("records")

        natureza_filtro = natureza.copy()
        if sel_unidade:
            natureza_filtro = natureza_filtro[natureza_filtro["unidade"] == sel_unidade]
        if sel_categoria and sel_categoria in categoria_lookup:
            natureza_filtro = natureza_filtro[natureza_filtro["categoria_pi"] == categoria_lookup[sel_categoria]]
        if focus_metric in categoria_lookup.values():
            natureza_filtro = natureza_filtro[natureza_filtro["categoria_pi"] == focus_metric]
            natureza_caption = f"Detalhamento mostra {CREDITOS_KPI_LABELS[focus_metric]}."
        if not natureza_filtro.empty:
            natureza_filtro = natureza_filtro.sort_values("credito_disponivel", ascending=False).head(80)
            natureza_filtro_form = natureza_filtro.copy()
            natureza_filtro_form["credito_disponivel"] = natureza_filtro_form["credito_disponivel"].apply(format_currency)
            tabela_natureza = natureza_filtro_form.to_dict("records")

    return (
        UNIDADE_OPTIONS,
        CATEGORIA_OPTIONS,
        *kpis,
        alertas_component,
        destaque,
        tabela_caption,
        natureza_caption,
        figura_categoria,
        figura_despesas,
        figura_pizza,
        tabela_resumo,
        tabela_natureza,
    )


if __name__ == "__main__":
    app.run_server(debug=True, host="0.0.0.0", port=8050)
