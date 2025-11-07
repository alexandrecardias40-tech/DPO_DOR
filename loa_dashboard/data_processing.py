"""Funções utilitárias para carregar e transformar dados do arquivo Limites LOA."""

from __future__ import annotations

import base64
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import numpy as np
import pandas as pd

BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_EXCEL = BASE_DIR / "Limites LOA 2025 20.10.2025.xlsx"
UPLOADS_DIR = BASE_DIR / "uploads"


MONTH_NAME_PT = {
    1: "Jan",
    2: "Fev",
    3: "Mar",
    4: "Abr",
    5: "Mai",
    6: "Jun",
    7: "Jul",
    8: "Ago",
    9: "Set",
    10: "Out",
    11: "Nov",
    12: "Dez",
}


FONTE_CATEGORIAS = {
    "1000": "Tesouro - Recursos do Orçamento Fiscal",
    "3008": "Tesouro - Vinculado (Decentralizado)",
    "1050": "Receita Própria",
    "1050.1": "Receita Própria - Convênios",
    "1051": "Receita Própria - Investimentos",
    "3050": "Superávit - Receita Própria 1050",
    "3051": "Superávit - Receita Própria 1051",
}


def _ensure_excel(path: Optional[str | Path]) -> Path:
    if path is None:
        if not DEFAULT_EXCEL.exists():
            raise FileNotFoundError(
                f"Arquivo padrão não encontrado: {DEFAULT_EXCEL!s}"
            )
        return DEFAULT_EXCEL
    resolved = Path(path).expanduser().resolve()
    if not resolved.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {resolved!s}")
    return resolved


def flatten_columns(columns: Iterable) -> List[str]:
    flattened = []
    for col in columns:
        if isinstance(col, tuple):
            parts = [str(part) for part in col if pd.notna(part)]
            flattened.append("|".join(parts))
        else:
            flattened.append(str(col))
    return flattened


def safe_divide(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    result = numerator / denominator.replace({0: np.nan})
    return result.replace({np.inf: np.nan, -np.inf: np.nan})


def load_fact_nl(excel_path: Path) -> pd.DataFrame:
    df = pd.read_excel(excel_path, sheet_name="NL", header=[1, 2, 3])
    df.columns = flatten_columns(df.columns)

    rename_map = {}
    for col in df.columns:
        if col.startswith("Nº da NL"):
            rename_map[col] = "numero_nl"
        elif col.startswith("Data da NL"):
            rename_map[col] = "data_nl"
        elif col.startswith("Histórico da NL"):
            rename_map[col] = "historico_nl"
    df = df.rename(columns=rename_map)

    id_cols = ["numero_nl", "data_nl", "historico_nl"]
    value_cols = [col for col in df.columns if col.startswith("Grupo de Despesa/FONTE")]

    fact = df.melt(
        id_vars=id_cols,
        value_vars=value_cols,
        var_name="dimensao_raw",
        value_name="valor",
    )
    fact = fact.dropna(subset=["valor"])
    fact["valor"] = pd.to_numeric(fact["valor"], errors="coerce")
    fact = fact.dropna(subset=["valor"])

    split_cols = fact["dimensao_raw"].str.split("|", expand=True)
    fact["categoria_limite"] = split_cols[1]
    fact["fonte_sof"] = split_cols[2].astype(str).str.strip()
    fact = fact.drop(columns=["dimensao_raw"])

    fact["data_nl"] = pd.to_datetime(fact["data_nl"], errors="coerce")
    fact = fact.dropna(subset=["numero_nl"])

    fact["tipo_despesa"] = np.where(
        fact["categoria_limite"].str.contains("INV", case=False, na=False),
        "Investimento",
        "Custeio",
    )
    fact["grupo_despesa"] = fact["tipo_despesa"].map(
        {"Investimento": 3.0, "Custeio": 4.0}
    )

    return fact.reset_index(drop=True)


def load_fact_orcamento(excel_path: Path, nl_df: pd.DataFrame) -> pd.DataFrame:
    df = pd.read_excel(excel_path, sheet_name="UO_26271", header=87)

    rename_map = {
        "Unidade Orçamentária": "unidade_orcamentaria",
        "Resultado Lei": "resultado_lei_codigo",
        "Unnamed: 19": "resultado_lei_categoria",
        "Grupo Despesa": "grupo_despesa",
        "Ação Governo": "acao_governo",
        "Plano Orçamentário": "plano_orcamentario",
        "Unnamed: 23": "descricao_plano",
        "Item Informação": "fonte_sof",
        "DOTACAO INICIAL": "dotacao_inicial",
        "DOTACAO ATUALIZADA": "dotacao_atualizada",
        "DESPESAS EMPENHADAS": "despesas_empenhadas",
        "DESPESAS PAGAS": "despesas_pagas",
    }
    df = df.rename(columns=rename_map)

    df["unidade_orcamentaria"] = df["unidade_orcamentaria"].ffill()
    df["resultado_lei_codigo"] = df["resultado_lei_codigo"].ffill()
    df["resultado_lei_categoria"] = df["resultado_lei_categoria"].ffill()

    relevantes = [
        "unidade_orcamentaria",
        "resultado_lei_codigo",
        "resultado_lei_categoria",
        "grupo_despesa",
        "acao_governo",
        "plano_orcamentario",
        "descricao_plano",
        "fonte_sof",
        "dotacao_inicial",
        "dotacao_atualizada",
        "despesas_empenhadas",
        "despesas_pagas",
    ]
    df = df[relevantes]
    df = df.dropna(subset=["plano_orcamentario", "fonte_sof"], how="any")

    numeric_cols = [
        "dotacao_inicial",
        "dotacao_atualizada",
        "despesas_empenhadas",
        "despesas_pagas",
    ]
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)

    df["grupo_despesa"] = pd.to_numeric(df["grupo_despesa"], errors="coerce")
    df["grupo_despesa_nome"] = df["grupo_despesa"].map({3.0: "Investimento", 4.0: "Custeio"})

    df["fonte_sof"] = df["fonte_sof"].astype(str).str.strip()
    df["fonte_categoria"] = df["fonte_sof"].map(FONTE_CATEGORIAS).fillna("Outro")

    nl_lookup = (
        nl_df.groupby(["fonte_sof", "grupo_despesa"])["valor"].sum()
        .reset_index()
        .rename(columns={"valor": "limite_liberado"})
    )
    df = df.merge(
        nl_lookup,
        how="left",
        on=["fonte_sof", "grupo_despesa"],
    )
    df["limite_liberado"] = df["limite_liberado"].fillna(0.0)
    df["limite_retido"] = df["dotacao_inicial"] - df["limite_liberado"]

    df["saldo_a_empenhar_limite"] = df["limite_liberado"] - df["despesas_empenhadas"]
    df["saldo_a_empenhar_dotacao"] = df["dotacao_atualizada"] - df["despesas_empenhadas"]
    df["saldo_a_pagar"] = df["despesas_empenhadas"] - df["despesas_pagas"]

    df["pct_limite_vs_dotacao"] = safe_divide(df["limite_liberado"], df["dotacao_inicial"])
    df["pct_empenhado_vs_dotacao"] = safe_divide(df["despesas_empenhadas"], df["dotacao_inicial"])
    df["pct_pago_vs_empenhado"] = safe_divide(df["despesas_pagas"], df["despesas_empenhadas"])

    return df.reset_index(drop=True)


def normalize_month_column(column: Any) -> Optional[str]:
    if column is None or (isinstance(column, float) and pd.isna(column)):
        return None
    if isinstance(column, (pd.Timestamp, datetime, date)):
        return pd.Timestamp(column).strftime("%Y-%m")

    column_str = str(column).strip()
    if not column_str:
        return None

    try:
        parsed = pd.to_datetime(column_str, errors="raise")
        return parsed.strftime("%Y-%m")
    except Exception:
        pass

    if "/" in column_str:
        parts = column_str.split("/")
        if len(parts) == 2:
            month_part, year_part = parts
            month_part = month_part.strip().lower()
            months_map = {
                "jan": "01",
                "fev": "02",
                "mar": "03",
                "abr": "04",
                "mai": "05",
                "jun": "06",
                "jul": "07",
                "ago": "08",
                "set": "09",
                "out": "10",
                "nov": "11",
                "dez": "12",
            }
            month_num = months_map.get(month_part[:3])
            if month_num:
                return f"{year_part}-{month_num}"

    return column_str if column_str else None


def load_fact_receitas(excel_path: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    df = pd.read_excel(excel_path, sheet_name="Receitas", header=3)

    rename_map = {
        "Unnamed: 0": "unidade_orcamentaria",
        "Unnamed: 1": "fonte_sof",
        "Natureza Receita": "natureza_receita",
        "Unnamed: 3": "descricao_receita",
        "Unnamed: 14": "total_jan_out",
        "Unnamed: 15": "total_fev_jul_set",
        "Unnamed: 16": "media_mensal",
        "Unnamed: 17": "estimativa_total_anual",
    }
    df = df.rename(columns=rename_map)
    df["unidade_orcamentaria"] = df["unidade_orcamentaria"].ffill()
    df["fonte_sof"] = df["fonte_sof"].ffill()

    month_columns = [
        col
        for col in df.columns
        if ("2025" in str(col) and "total" not in str(col).lower())
    ]

    melted = df.melt(
        id_vars=[
            "unidade_orcamentaria",
            "fonte_sof",
            "natureza_receita",
            "descricao_receita",
        ],
        value_vars=month_columns,
        var_name="mes_raw",
        value_name="valor",
    )
    melted = melted.dropna(subset=["valor"])
    melted["valor"] = pd.to_numeric(melted["valor"], errors="coerce")
    melted = melted.dropna(subset=["valor"])

    melted["mes"] = melted["mes_raw"].apply(normalize_month_column)
    melted = melted.dropna(subset=["mes"])
    mes_dt = pd.to_datetime(melted["mes"], format="%Y-%m", errors="coerce")
    melted = melted[mes_dt.notna()].copy()
    mes_dt = mes_dt[mes_dt.notna()]
    melted["mes"] = mes_dt.dt.strftime("%Y-%m")
    melted["ano"] = mes_dt.dt.year.astype(str)
    melted["mes_num"] = mes_dt.dt.month.astype(int)
    melted = melted.drop(columns=["mes_raw"])

    melted["fonte_sof"] = melted["fonte_sof"].astype(str).str.strip()
    melted["unidade_orcamentaria"] = melted["unidade_orcamentaria"].astype(str).str.strip()
    melted["natureza_receita"] = melted["natureza_receita"].astype(str).str.strip()

    resumo_cols = [
        "unidade_orcamentaria",
        "fonte_sof",
        "natureza_receita",
        "descricao_receita",
        "total_jan_out",
        "total_fev_jul_set",
        "media_mensal",
        "estimativa_total_anual",
    ]
    resumo = df[resumo_cols].dropna(subset=["natureza_receita"]).copy()
    for col in [
        "total_jan_out",
        "total_fev_jul_set",
        "media_mensal",
        "estimativa_total_anual",
    ]:
        resumo[col] = pd.to_numeric(resumo[col], errors="coerce")

    return melted.reset_index(drop=True), resumo.reset_index(drop=True)


def build_dimensions(
    fact_orc: pd.DataFrame,
    fact_receitas: pd.DataFrame,
    resumo_receitas: pd.DataFrame,
) -> Dict[str, pd.DataFrame]:
    dim_mes = (
        fact_receitas[["mes", "ano", "mes_num"]]
        .drop_duplicates()
        .sort_values(["ano", "mes_num"])
        .reset_index(drop=True)
    )
    dim_mes = dim_mes.dropna(subset=["mes"]).copy()
    dim_mes["mes"] = dim_mes["mes"].astype(str)
    dt_index = pd.to_datetime(dim_mes["mes"], format="%Y-%m", errors="coerce")
    nomes = []
    for dt_value, fallback in zip(dt_index, dim_mes["mes"]):
        if pd.isna(dt_value):
            nomes.append(fallback)
        else:
            nomes.append(f"{MONTH_NAME_PT.get(dt_value.month, dt_value.strftime('%b')).title()}/{dt_value.year}")
    dim_mes["mes_nome"] = nomes

    dim_natureza = (
        resumo_receitas[["natureza_receita", "descricao_receita"]]
        .drop_duplicates()
        .reset_index(drop=True)
    )
    dim_natureza["natureza_receita"] = dim_natureza["natureza_receita"].astype(str).str.strip()
    dim_natureza["descricao_receita"] = dim_natureza["descricao_receita"].fillna("-")

    return {
        "dim_mes": dim_mes,
        "dim_natureza_receita": dim_natureza,
    }


def enrich_with_receita_propria(
    fact_orc: pd.DataFrame, fact_receitas: pd.DataFrame
) -> pd.DataFrame:
    receita_por_fonte = (
        fact_receitas.groupby("fonte_sof")["valor"].sum().reset_index()
    ).rename(columns={"valor": "receita_realizada"})

    combinado = fact_orc.merge(
        receita_por_fonte,
        on="fonte_sof",
        how="left",
    )
    combinado["receita_realizada"] = combinado["receita_realizada"].fillna(0.0)
    combinado["pct_limite_vs_receita"] = safe_divide(
        combinado["limite_liberado"], combinado["receita_realizada"]
    )
    return combinado


def extract_summary_tables(excel_path: Path) -> Dict[str, pd.DataFrame]:
    raw = pd.read_excel(excel_path, sheet_name="UO_26271", header=None)

    def parse_section(header_row: int, end_col: int = 13) -> pd.DataFrame:
        header_slice = raw.iloc[header_row, 1:end_col]
        headers: list[str] = []
        indices: list[int] = []
        for idx, value in enumerate(header_slice, start=1):
            if pd.isna(value):
                continue
            headers.append(str(value).replace("\n", " ").strip())
            indices.append(idx)

        if not headers:
            return pd.DataFrame(columns=["Categoria"])

        data = raw.iloc[header_row + 1 :, indices].copy()
        data.columns = headers
        first_col = headers[0]
        data = data[data[first_col].notna()]
        numeric_cols = headers[1:]
        for col in numeric_cols:
            data[col] = pd.to_numeric(data[col], errors="coerce")
        data = data.dropna(how="all", subset=numeric_cols)
        data = data.rename(columns={first_col: "Categoria"})
        data = data.reset_index(drop=True)
        return data

    return {
        "tesouro": parse_section(7, end_col=13),
        "receita": parse_section(26, end_col=13),
    }


@lru_cache(maxsize=4)
def _load_datasets_cached(resolved_excel: str) -> Dict[str, Any]:
    excel_path = Path(resolved_excel)
    fact_nl = load_fact_nl(excel_path)
    fact_nl["tipo_despesa"] = fact_nl["tipo_despesa"].fillna("Sem classificação")
    fact_orc = load_fact_orcamento(excel_path, fact_nl)
    fact_receitas, resumo_receitas = load_fact_receitas(excel_path)
    fact_orc = enrich_with_receita_propria(fact_orc, fact_receitas)
    dimensoes = build_dimensions(fact_orc, fact_receitas, resumo_receitas)
    summaries = extract_summary_tables(excel_path)

    fonte_options = sorted(fact_orc["fonte_sof"].dropna().unique().tolist())
    grupo_options = sorted(
        fact_orc["grupo_despesa_nome"].fillna("Sem classificação").unique().tolist()
    )
    acao_options = sorted(
        fact_orc["acao_governo"].fillna("Sem ação").unique().tolist()
    )
    plano_options = sorted(fact_orc["plano_orcamentario"].dropna().unique().tolist())
    mes_options = dimensoes["dim_mes"]["mes"].tolist()
    natureza_options = (
        dimensoes["dim_natureza_receita"]["natureza_receita"].dropna().unique().tolist()
    )

    return {
        "fact_orcamento": fact_orc.reset_index(drop=True),
        "fact_receitas": fact_receitas.reset_index(drop=True),
        "fact_nl": fact_nl.reset_index(drop=True),
        "dim_mes": dimensoes["dim_mes"],
        "dim_natureza": dimensoes["dim_natureza_receita"],
        "tesouro_summary": summaries["tesouro"],
        "receita_summary": summaries["receita"],
        "fonte_options": fonte_options,
        "grupo_options": grupo_options,
        "acao_options": acao_options,
        "plano_options": plano_options,
        "mes_options": mes_options,
        "natureza_options": natureza_options,
        "excel_path": str(excel_path),
    }


def load_datasets(excel_path: Optional[str | Path] = None) -> Dict[str, Any]:
    resolved = _ensure_excel(excel_path)
    return _load_datasets_cached(str(resolved.resolve()))


def refresh_global_datasets(excel_path: Optional[str | Path] = None) -> Dict[str, Any]:
    resolved = _ensure_excel(excel_path)
    _load_datasets_cached.cache_clear()
    return _load_datasets_cached(str(resolved.resolve()))


def save_uploaded_excel(contents: str, filename: str) -> Path:
    if not contents:
        raise ValueError("Arquivo vazio ou inválido.")
    if "," not in contents:
        raise ValueError("Conteúdo de upload inválido.")

    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    destination = UPLOADS_DIR / filename
    _, encoded = contents.split(",", 1)
    binary = base64.b64decode(encoded)
    destination.write_bytes(binary)
    return destination
