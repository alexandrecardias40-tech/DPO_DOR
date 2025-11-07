from __future__ import annotations

import re
import unicodedata
from difflib import get_close_matches
from functools import lru_cache
from pathlib import Path
from typing import Dict, Optional

import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent


def _ensure_path(base_dir: Optional[str | Path]) -> Path:
    if base_dir is None:
        return BASE_DIR
    base_path = Path(base_dir)
    if not base_path.exists():
        raise FileNotFoundError(f"Base directory {base_path!s} not found.")
    return base_path


def _sanitize_column(name: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(name))
    ascii_text = normalized.encode("ASCII", "ignore").decode("ASCII")
    ascii_text = ascii_text.lower()
    ascii_text = re.sub(r"[^a-z0-9]+", "_", ascii_text)
    return ascii_text.strip("_")


def _resolve_column(normalized_target: str, available: Dict[str, str]) -> Optional[str]:
    direct = available.get(normalized_target)
    if direct is not None:
        return direct
    candidates = get_close_matches(normalized_target, available.keys(), n=1, cutoff=0.55)
    if candidates:
        return available[candidates[0]]
    return None


def _rename_using_map(df: pd.DataFrame, expected_map: Dict[str, str], context: str) -> pd.DataFrame:
    available = {_sanitize_column(col): col for col in df.columns}
    rename_dict: Dict[str, str] = {}
    missing = []

    for normalized_name, target_name in expected_map.items():
        original = _resolve_column(normalized_name, available)
        if original is None:
            missing.append(target_name)
            continue
        rename_dict[original] = target_name

    if missing:
        raise KeyError(
            f"Colunas ausentes na planilha {context}: {', '.join(missing)}. "
            f"Colunas encontradas: {list(df.columns)}"
        )

    return df.rename(columns=rename_dict)


def _normalize_numeric_value(value):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        cleaned = (
            cleaned.replace("R$", "")
            .replace("%", "")
            .replace(" ", "")
            .replace(".", "")
            .replace(",", ".")
        )
        cleaned = re.sub(r"[^0-9\-.]", "", cleaned)
        if not cleaned:
            return None
        try:
            return float(cleaned)
        except ValueError:
            return None
    return value


def _to_numeric(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series.apply(_normalize_numeric_value), errors="coerce")


def _load_matriz_df(base_path: Path) -> pd.DataFrame:
    path = base_path / "Tabela Aprovado - Copia (2).xlsx"
    if not path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {path}")

    df = pd.read_excel(path)
    df = _rename_using_map(
        df,
        {
            "ugr": "ugr",
            "unidade": "unidade",
            "pi": "pi",
            "total_aprovado": "total_aprovado",
            "credito_disponivel": "credito_disponivel",
            "empenhado": "empenhado",
            "debitos": "debitos",
            "total_executado": "total_executado",
        },
        "Tabela Aprovado - Copia (2).xlsx",
    )

    numeric_cols = [
        "total_aprovado",
        "credito_disponivel",
        "empenhado",
        "debitos",
        "total_executado",
    ]
    for col in numeric_cols:
        df[col] = _to_numeric(df[col])

    df["saldo"] = df["credito_disponivel"] - df["empenhado"]
    df["pct_empenhado_sobre_aprovado"] = (
        df["empenhado"] / df["total_aprovado"]
    ).replace([pd.NA, pd.NaT], pd.NA)
    df["pct_empenhado_sobre_credito"] = (
        df["empenhado"] / df["credito_disponivel"]
    ).replace([pd.NA, pd.NaT], pd.NA)

    return df


def _load_credito_detalhado_df(base_path: Path) -> pd.DataFrame:
    path = base_path / "Credito disponível e valor empenhado.xlsx"
    if not path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {path}")

    df = pd.read_excel(path)
    df = _rename_using_map(
        df,
        {
            "ugr": "ugr",
            "unidade": "unidade",
            "pi": "pi",
            "natureza_da_despesa": "natureza_despesa",
            "credito_disponivel": "credito_disponivel",
            "despesas_empenhadas": "despesas_empenhadas",
        },
        "Credito disponível e valor empenhado.xlsx",
    )

    for col in ["credito_disponivel", "despesas_empenhadas"]:
        df[col] = _to_numeric(df[col])

    df["saldo"] = df["credito_disponivel"] - df["despesas_empenhadas"]

    return df


def _load_conrazao_df(base_path: Path) -> pd.DataFrame:
    path = base_path / "Conrazao Pulverizado (4).xlsx"
    if not path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {path}")

    raw_df = pd.read_excel(path, header=2)
    df = raw_df.iloc[1:].copy()
    df = _rename_using_map(
        df,
        {
            "ug_responsavel": "ugr",
            "unnamed_3": "unidade",
            "unnamed_5": "descricao_pi",
            "item_informacao": "item_informacao",
            "unnamed_7": "descricao_natureza",
            "credito_disponivel": "credito_disponivel",
            "total": "total_movimentos",
            "ptres": "PTRES",
            "pi": "PI",
        },
        "Conrazao Pulverizado (4).xlsx",
    )

    df["PTRES"] = df["PTRES"].astype(str).str.strip()
    df = df[df["PTRES"] == "230639"]

    for col in ["credito_disponivel", "total_movimentos"]:
        df[col] = _to_numeric(df[col])

    df["ugr"] = _to_numeric(df["ugr"])

    matriz_codes = {
        "MGY01N0104N": "Matriz Acadêmica (MGY01N0104N)",
        "VGY01N0105N": "Matriz Administrativa (VGY01N0105N)",
    }
    df["categoria_pi"] = df["PI"].map(matriz_codes).fillna("Demais créditos PTRES 230639")

    return df


def _build_creditos_categoria_df(conrazao_df: pd.DataFrame) -> pd.DataFrame:
    agrupado = (
        conrazao_df.groupby(["unidade", "categoria_pi"], as_index=False)["credito_disponivel"]
        .sum()
    )

    pivot = (
        agrupado.pivot(index="unidade", columns="categoria_pi", values="credito_disponivel")
        .fillna(0.0)
        .reset_index()
    )
    pivot.columns.name = None

    categorias = [
        "Matriz Acadêmica (MGY01N0104N)",
        "Matriz Administrativa (VGY01N0105N)",
        "Demais créditos PTRES 230639",
    ]
    for categoria in categorias:
        if categoria not in pivot.columns:
            pivot[categoria] = 0.0

    pivot["total_credito_ptres_230639"] = pivot[categorias].sum(axis=1)

    return pivot


@lru_cache(maxsize=1)
def load_datasets(base_dir: Optional[str | Path] = None) -> Dict[str, pd.DataFrame]:
    base_path = _ensure_path(base_dir)

    matriz_df = _load_matriz_df(base_path)
    credito_detalhado_df = _load_credito_detalhado_df(base_path)
    conrazao_df = _load_conrazao_df(base_path)
    creditos_categoria_df = _build_creditos_categoria_df(conrazao_df)

    unidades_series = [
        matriz_df["unidade"],
        credito_detalhado_df["unidade"],
        conrazao_df["unidade"],
    ]
    unidades = pd.concat(unidades_series, ignore_index=True)
    unidades = sorted(
        {
            u
            for u in unidades.dropna().unique()
            if isinstance(u, str) and u.strip()
        }
    )

    return {
        "matriz": matriz_df,
        "credito_detalhado": credito_detalhado_df,
        "conrazao_ptres": conrazao_df,
        "creditos_categoria": creditos_categoria_df,
        "unidades": unidades,
    }
