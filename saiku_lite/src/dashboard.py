from __future__ import annotations

import io
import math
import os
import re
import unicodedata
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from fpdf import FPDF

# Thresholds (configurable via environment variables if needed)
LIMITE_DIAS_VENCIMENTO = int(os.getenv("LIMITE_DIAS_VENCIMENTO", "60"))
PCT_SALDO_BAIXO = float(os.getenv("PCT_SALDO_BAIXO", "0.20"))
PCT_EXEC_ALTA = float(os.getenv("PCT_EXEC_ALTA", "1.20"))

SUPPORTED_SCENARIO_FIELDS = {"total_estimado", "executado_total", "empenhado_total"}

COLUMN_ALIASES: Dict[str, List[str]] = {
    "descricao": [
        "descricao das despesas",
        "descricao despesa",
        "descricao",
        "descricao das despesa",
        "tipo da despesa",
        "tipo objeto despesa",
    ],
    "ugr": ["ugr", "unidade gestora", "unidade gestoral", "unidade gestora responsavel"],
    "pi": ["pi 2025", "pi", "plano interno", "pi2024", "pi2026", "plano interno 2025"],
    "cnpj": ["cnpj", "cnpj fornecedor", "cnpj contratada", "cnpj/fornecedor"],
    "processo": ["processo", "numero processo", "n processo", "processo sei", "processo administrativo"],
    "contrato": ["n contrato", "numero contrato", "nº contrato", "contrato", "numero do contrato"],
    "vigencia": ["vigencia", "vigencia final", "data vigencia", "vigencia termino", "vigencia fim"],
    "status": ["status do contrato", "status", "situacao do contrato", "situação do contrato"],
    "prorrogacao": ["situacao da prorrogacao", "situacao prorrogacao", "prorrogacao", "situação da prorrogação"],
    "valor_mensal": [
        "valor contrato media mensal",
        "valor contrato mensal",
        "valor medio mensal",
        "valor contratos media mensal",
    ],
    "total_estimado": ["total estimado anual", "estimado anual", "total estimado", "total previsto anual"],
    "saldo_empenhos": ["saldo empenhos 2025", "saldo empenhos", "saldo de empenhos 2025"],
    "saldo_rap": ["saldo de empenhos rap", "saldo empenhos rap", "saldo rap"],
    "total_rap_empenho": [
        "total rap + empenho",
        "total rap+empenho",
        "total rap e empenho",
        "total rap mais empenho",
        "total rap+ empenho",
        "total rap +empenho",
    ],
}

DEFAULT_LABELS: Dict[str, str] = {
    "descricao": "Descrição das despesas",
    "ugr": "UGR",
    "pi": "PI 2025",
    "cnpj": "CNPJ",
    "processo": "Processo",
    "contrato": "nº Contrato",
    "vigencia": "Vigência",
    "status": "Status do Contrato",
    "prorrogacao": "Situação da prorrogação",
    "valor_mensal": "Valor Contrato Média mensal",
    "total_estimado": "Total estimado Anual",
    "saldo_empenhos": "Saldo Empenhos 2025",
    "saldo_rap": "Saldo de Empenhos RAP",
    "total_rap_empenho": "Total RAP + Empenho",
    "executado_total": "Executado Total",
    "empenhado_total": "Empenhado Total",
    "saldo_previsto": "Saldo Previsto",
    "execucao_pct": "Execução (%)",
    "media_mensal_exec": "Média Mensal Executada",
}

MONTH_NAME_MAP = {
    "jan": 1,
    "janeiro": 1,
    "fev": 2,
    "fevereiro": 2,
    "mar": 3,
    "marco": 3,
    "março": 3,
    "abr": 4,
    "abril": 4,
    "mai": 5,
    "maio": 5,
    "jun": 6,
    "junho": 6,
    "jul": 7,
    "julho": 7,
    "ago": 8,
    "agosto": 8,
    "set": 9,
    "setembro": 9,
    "sep": 9,
    "out": 10,
    "outubro": 10,
    "nov": 11,
    "novembro": 11,
    "dez": 12,
    "dezembro": 12,
}


class DashboardError(RuntimeError):
    """Raised when dashboard data cannot be processed."""


def _normalize_string(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    normalized = unicodedata.normalize("NFKD", str(value))
    stripped = "".join(char for char in normalized if not unicodedata.combining(char))
    stripped = stripped.replace("\n", " ")
    stripped = re.sub(r"[^a-zA-Z0-9]+", " ", stripped)
    return re.sub(r"\s+", " ", stripped).strip().lower()


def _match_alias(column: str, aliases: Sequence[str]) -> bool:
    normalized = _normalize_string(column)
    return normalized in aliases


def _normalize_number(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return 0.0
    text = text.replace("R$", "").replace(" ", "")
    if text in {"-", "--"}:
        return 0.0
    if ";" in text:
        text = text.replace(";", "")
    has_comma = "," in text
    has_dot = "." in text
    if has_comma and has_dot:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif has_comma:
        text = text.replace(".", "").replace(",", ".")
    else:
        text = text.replace(",", "")
    try:
        return float(text)
    except Exception:
        return 0.0


def _coerce_numeric(series: Iterable[Any]) -> pd.Series:
    if isinstance(series, pd.Series):
        return series.apply(_normalize_number).fillna(0.0)
    values = [_normalize_number(item) for item in series]
    return pd.Series(values, dtype=float)


def _safe_division(numerator: float, denominator: float) -> float:
    if denominator in (0, None) or (isinstance(denominator, float) and math.isclose(denominator, 0.0)):
        return 0.0
    return float(numerator) / float(denominator)


SUMMARY_KEYWORDS = (
    "total",
    "total geral",
    "total de",
    "total da",
    "total das",
    "total dos",
)


def _normalize_text(value: Any) -> str:
    text = str(value or "").strip()
    lowered = text.lower()
    if lowered in {"nan", "none", "null"}:
        return ""
    return lowered


def _is_summary_row(row: pd.Series) -> bool:
    desc = _normalize_text(row.get("descricao") or row.get("Despesa"))
    ugr = _normalize_text(row.get("ugr") or row.get("UGR"))
    pi = _normalize_text(row.get("pi") or row.get("PI_2025"))
    if not desc and not ugr and not pi:
        return True
    if not desc:
        return False
    if desc in {"total", "total geral"}:
        return True
    if desc.startswith("total da ") or desc.startswith("total de ") or desc.startswith("total dos") or desc.startswith("total das"):
        return True
    if desc.startswith("total ") and not ugr:
        return True
    return False


@dataclass
class MonthInfo:
    key: str
    label: str
    order: datetime
    source: str


@dataclass
class DashboardDataset:
    id: str
    name: str
    frame: pd.DataFrame
    original_frame: pd.DataFrame
    month_columns: List[str]
    month_metadata: List[MonthInfo]
    filters: Dict[str, List[str]]
    warnings: List[str]
    column_map: Dict[str, str]
    created_at: datetime = field(default_factory=datetime.utcnow)


def _detect_month_columns(frame: pd.DataFrame) -> Tuple[List[str], List[MonthInfo], List[str]]:
    month_columns: List[str] = []
    metadata: List[MonthInfo] = []
    warnings: List[str] = []

    seen_keys: set[str] = set()

    for original in frame.columns:
        column = frame[original]
        normalized = _normalize_string(original)
        timestamp: Optional[datetime] = None

        if isinstance(column, pd.Series) and pd.api.types.is_datetime64_any_dtype(column):
            try:
                timestamp = pd.to_datetime(column).dt.normalize().iloc[0]
            except Exception:
                timestamp = None

        if timestamp is None:
            try:
                timestamp = pd.to_datetime(original, errors="raise").to_pydatetime()
            except Exception:
                timestamp = None

        if timestamp is None:
            match = re.search(r"(\d{4})[-/](\d{1,2})", normalized)
            if match:
                year = int(match.group(1))
                month = int(match.group(2))
                timestamp = datetime(year, month, 1)

        if timestamp is None:
            for token, month in MONTH_NAME_MAP.items():
                if token in normalized:
                    year_match = re.search(r"(\d{4})", normalized)
                    year = int(year_match.group(1)) if year_match else datetime.utcnow().year
                    timestamp = datetime(year, month, 1)
                    break

        if timestamp is None:
            continue

        key = f"month_{timestamp.year}_{timestamp.month:02d}"
        if key in seen_keys:
            continue
        seen_keys.add(key)

        month_columns.append((key, original))
        metadata.append(
            MonthInfo(
                key=key,
                label=timestamp.strftime("%b/%Y").capitalize(),
                order=timestamp,
                source=original,
            )
        )

    metadata.sort(key=lambda item: item.order)
    ordered_columns = [key for key, _ in sorted(month_columns, key=lambda kv: next(item.order for item in metadata if item.key == kv[0]))]
    return ordered_columns, metadata, warnings


def _normalize_filters(frame: pd.DataFrame) -> Dict[str, List[str]]:
    def _distinct(series: pd.Series) -> List[str]:
        values = []
        seen = set()
        for value in series.dropna().unique():
            text = str(value).strip()
            if not text or text.lower() == 'nan':
                continue
            if text in seen:
                continue
            seen.add(text)
            values.append(text)
        return sorted(values)

    filters = {
        "ugr": _distinct(frame["ugr"]),
        "pi": _distinct(frame["pi"]),
        "descricao": _distinct(frame["descricao"]),
        "status": _distinct(frame["status"]),
        "cnpj": _distinct(frame["cnpj"]),
    }
    return filters


def _canonical_value(series: pd.Series, default: float = 0.0) -> pd.Series:
    return _coerce_numeric(series) if not series.empty else pd.Series(default, index=series.index)


def _months_elapsed(month_info: List[MonthInfo]) -> int:
    today = datetime.utcnow()
    elapsed = [info for info in month_info if info.order <= today]
    return len(elapsed) if elapsed else len(month_info)


def _apply_filters(frame: pd.DataFrame, filters: Dict[str, List[str]]) -> pd.DataFrame:
    df = frame.copy()
    for key in ("ugr", "pi", "descricao", "status", "cnpj"):
        selected = filters.get(key) or []
        if selected:
            normalized_selection = {str(value).lower() for value in selected}
            df = df[df[key].astype(str).str.lower().isin(normalized_selection)]
    return df


def _apply_month_filter(month_info: List[MonthInfo], selected_months: Sequence[str]) -> List[MonthInfo]:
    if not selected_months:
        return month_info
    selected_set = set(selected_months)
    return [info for info in month_info if info.key in selected_set]


def _build_alerts(
    df: pd.DataFrame,
    month_info: List[MonthInfo],
) -> List[Dict[str, Any]]:
    alerts: Dict[int, Dict[str, Any]] = {}
    today = datetime.utcnow().date()
    months_elapsed = max(1, _months_elapsed(month_info))

    for index, row in df.iterrows():
        motivos: List[str] = []
        severity = "info"
        icon = "🔵"
        status_text = str(row.get("status") or "").strip().upper()
        vigencia = row.get("vigencia")
        vigencia_date = vigencia.date() if isinstance(vigencia, pd.Timestamp) else None

        # Contrato vencido
        vencido = False
        if status_text and status_text != "NO PRAZO":
            vencido = True
        if vigencia_date and vigencia_date < today:
            vencido = True
        if vencido:
            motivos.append("Contrato vencido ou status fora de prazo.")
            severity = "critical"
            icon = "🔴"

        # Vence em breve
        if vigencia_date and today <= vigencia_date <= (today + timedelta(days=LIMITE_DIAS_VENCIMENTO)):
            motivos.append(f"Contrato vence em { (vigencia_date - today).days } dias.")
            if severity != "critical":
                severity = "warning"
                icon = "🟠"

        # Saldo baixo
        total_estimado = float(row.get("total_estimado") or 0.0)
        saldo_previsto = float(row.get("saldo_previsto") or 0.0)
        if total_estimado > 0 and saldo_previsto <= total_estimado * PCT_SALDO_BAIXO:
            motivos.append("Saldo previsto menor que 20% do total estimado.")
            if severity not in {"critical", "warning"}:
                severity = "attention"
                icon = "⚠️"

        # Execução acima do esperado
        valor_mensal = float(row.get("valor_mensal") or 0.0)
        executado_total = float(row.get("executado_total") or 0.0)
        if valor_mensal > 0:
            limite_exec = valor_mensal * months_elapsed * PCT_EXEC_ALTA
            if executado_total > limite_exec:
                motivos.append("Execução acima do esperado para o período.")
                if severity not in {"critical", "warning"}:
                    severity = "purple"
                    icon = "🟣"

        # Sem RAP/Empenho
        empenhado_total = float(row.get("empenhado_total") or 0.0)
        if math.isclose(empenhado_total, 0.0, abs_tol=1e-6):
            motivos.append("Empenhado ausente (RAP/Empenho não registrado).")
            if severity not in {"critical", "warning", "purple"}:
                severity = "info"
                icon = "🔵"

        if motivos:
            alerts[index] = {
                "descricao": row.get("descricao"),
                "ugr": row.get("ugr"),
                "pi": row.get("pi"),
                "status": row.get("status"),
                "vigencia": row.get("vigencia_str"),
                "motivo": " ".join(motivos),
                "severity": severity,
                "icon": icon,
            }

    # Order alerts by severity preference
    order = {"critical": 0, "warning": 1, "purple": 2, "attention": 3, "info": 4}
    return sorted(alerts.values(), key=lambda alert: order.get(alert["severity"], 99))


def _build_heatmap(
    df: pd.DataFrame,
    month_info: List[MonthInfo],
    limit: int = 10,
) -> Dict[str, Any]:
    result = {
        "rows": [],
        "months": [{"key": info.key, "label": info.label} for info in month_info],
        "maxValue": 0.0,
    }
    if df.empty or not month_info:
        return result

    top_descriptions = (
        df.groupby("descricao")["executado_total"].sum().sort_values(ascending=False).head(limit).index.tolist()
    )
    subset = df[df["descricao"].isin(top_descriptions)]
    if subset.empty:
        return result

    max_value = 0.0
    rows_data = []

    for descricao in top_descriptions:
        row_df = subset[subset["descricao"] == descricao]
        values = []
        for info in month_info:
            value = row_df[info.key].sum()
            values.append(float(value))
            max_value = max(max_value, float(value))
        media = float(row_df["media_mensal_exec"].mean() or 0.0)
        highlights = [value > media if media > 0 else False for value in values]
        rows_data.append(
            {
                "descricao": descricao,
                "values": values,
                "media": media,
                "highlights": highlights,
            }
        )

    result["rows"] = rows_data
    result["maxValue"] = max_value
    return result


def _build_charts(
    df: pd.DataFrame,
    month_info: List[MonthInfo],
    selected_months: Sequence[str],
    chart_mode: str,
) -> Dict[str, Any]:
    charts: Dict[str, Any] = {}

    if df.empty:
        charts["despesasUGR"] = {"labels": [], "values": []}
        charts["distribuicaoDescricao"] = {"labels": [], "values": []}
        charts["execucaoMensal"] = {"labels": [], "values": []}
        charts["planejadoEmpenhadoExecutado"] = {"mode": chart_mode, "labels": [], "datasets": {}}
        charts["heatmap"] = _build_heatmap(df, month_info)
        return charts

    # Despesas por UGR
    by_ugr = (
        df.groupby("ugr")["executado_total"]
        .sum()
        .sort_values(ascending=False)
        .head(8)
    )
    charts["despesasUGR"] = {
        "labels": by_ugr.index.tolist(),
        "values": [float(value) for value in by_ugr.values],
    }

    # Distribuição por descrição (top 10 + outros)
    descricao_totals = df.groupby("descricao")["executado_total"].sum().sort_values(ascending=False)
    top = descricao_totals.head(6)
    rest = descricao_totals.iloc[6:].sum()
    labels = top.index.tolist()
    values = [float(value) for value in top.values]
    if rest > 0:
        labels.append("Outros")
        values.append(float(rest))
    charts["distribuicaoDescricao"] = {"labels": labels, "values": values}

    # Série mensal
    active_months = _apply_month_filter(month_info, selected_months)
    labels_mensal: List[str] = []
    valores_mensal: List[float] = []
    for info in active_months:
        labels_mensal.append(info.label)
        valores_mensal.append(float(df[info.key].sum()))
    charts["execucaoMensal"] = {"labels": labels_mensal, "values": valores_mensal}

    # Planejado x Empenhado x Executado
    if chart_mode == "ugr":
        agrupado = df.groupby("ugr").agg(
            planejado=("total_estimado", "sum"),
            empenhado=("empenhado_total", "sum"),
            executado=("executado_total", "sum"),
        )
        charts["planejadoEmpenhadoExecutado"] = {
            "mode": "ugr",
            "labels": agrupado.index.tolist(),
            "datasets": {
                "planejado": [float(value) for value in agrupado["planejado"].values],
                "empenhado": [float(value) for value in agrupado["empenhado"].values],
                "executado": [float(value) for value in agrupado["executado"].values],
            },
        }
    else:
        charts["planejadoEmpenhadoExecutado"] = {
            "mode": "total",
            "labels": ["Totais"],
            "datasets": {
                "planejado": [float(df["total_estimado"].sum())],
                "empenhado": [float(df["empenhado_total"].sum())],
                "executado": [float(df["executado_total"].sum())],
            },
        }

    charts["heatmap"] = _build_heatmap(df, active_months)
    return charts


def _build_table(df: pd.DataFrame, column_map: Dict[str, str]) -> Dict[str, Any]:
    def label(key: str, fallback: str) -> str:
        return column_map.get(key, DEFAULT_LABELS.get(key, fallback))

    columns = [
        {"key": "descricao", "label": label("descricao", "Descrição das despesas")},
        {"key": "ugr", "label": label("ugr", "UGR")},
        {"key": "pi", "label": label("pi", "PI 2025")},
        {"key": "empenhado_total", "label": label("empenhado_total", "Empenhado Total")},
        {"key": "executado_total", "label": label("executado_total", "Executado Total")},
        {"key": "total_estimado", "label": label("total_estimado", "Total estimado Anual")},
        {"key": "saldo_previsto", "label": label("saldo_previsto", "Saldo Previsto")},
        {"key": "status", "label": label("status", "Status do Contrato")},
        {"key": "vigencia_str", "label": label("vigencia", "Vigência")},
        {"key": "cnpj", "label": label("cnpj", "CNPJ")},
        {"key": "processo", "label": label("processo", "Processo")},
        {"key": "contrato", "label": label("contrato", "nº Contrato")},
        {"key": "execucao_pct", "label": label("execucao_pct", "Execução (%)")},
    ]

    rows: List[Dict[str, Any]] = []
    for _, row in df.iterrows():
        rows.append(
            {
                "descricao": row.get("descricao"),
                "ugr": row.get("ugr"),
                "pi": row.get("pi"),
                "empenhado_total": float(row.get("empenhado_total") or 0.0),
                "executado_total": float(row.get("executado_total") or 0.0),
                "total_estimado": float(row.get("total_estimado") or 0.0),
                "saldo_previsto": float(row.get("saldo_previsto") or 0.0),
                "status": row.get("status"),
                "vigencia_str": row.get("vigencia_str"),
                "cnpj": row.get("cnpj"),
                "processo": row.get("processo"),
                "contrato": row.get("contrato"),
                "execucao_pct": float(row.get("execucao_pct") or 0.0),
            }
        )

    return {"columns": columns, "rows": rows}


def _compute_kpis(df: pd.DataFrame) -> Dict[str, Any]:
    total_estimado = float(df["total_estimado"].sum())
    empenhado_total = float(df["empenhado_total"].sum())
    executado_total = float(df["executado_total"].sum())
    execucao_pct = _safe_division(executado_total, total_estimado) * 100.0

    today = datetime.utcnow().date()
    vencendo = 0
    vencidos = 0
    for _, row in df.iterrows():
        vigencia = row.get("vigencia")
        status = str(row.get("status") or "").strip().upper()
        if isinstance(vigencia, pd.Timestamp):
            delta = (vigencia.date() - today).days
            if 0 <= delta <= LIMITE_DIAS_VENCIMENTO:
                vencendo += 1
            if delta < 0:
                vencidos += 1
        if status and status != "NO PRAZO":
            vencidos += 1

    return {
        "totalEstimado": total_estimado,
        "empenhado": empenhado_total,
        "executado": executado_total,
        "execucaoPercentual": execucao_pct,
        "contratosVencendo": int(vencendo),
        "contratosVencidos": int(vencidos),
    }


def _recompute_derived(
    df: pd.DataFrame,
    month_columns: Sequence[str],
) -> pd.DataFrame:
    month_values = df[list(month_columns)] if month_columns else pd.DataFrame(index=df.index)
    executed = month_values.sum(axis=1) if not month_values.empty else pd.Series(0, index=df.index, dtype=float)
    executed = executed.astype(float)
    if "total_rap_empenho" in df.columns:
        fallback = df["total_rap_empenho"].astype(float)
    else:
        fallback = df.get("empenhado_total", pd.Series(0, index=df.index, dtype=float)).astype(float)
    mask = executed <= 0
    executed = executed.where(~mask, fallback.where(fallback > 0, executed))
    df["executado_total"] = executed.astype(float)

    if "total_rap_empenho" in df.columns and not df["total_rap_empenho"].isna().all():
        df["empenhado_total"] = df["total_rap_empenho"].astype(float)
    else:
        saldo_empenhos = df["saldo_empenhos"] if "saldo_empenhos" in df.columns else 0
        saldo_rap = df["saldo_rap"] if "saldo_rap" in df.columns else 0
        df["empenhado_total"] = (saldo_empenhos.astype(float) + saldo_rap.astype(float)).fillna(0.0)

    df["saldo_previsto"] = df["total_estimado"].astype(float) - df["executado_total"].astype(float)
    df["execucao_pct"] = [
        _safe_division(exec, estimado) * 100.0 for exec, estimado in zip(df["executado_total"], df["total_estimado"])
    ]

    months_with_value = (
        month_values.apply(lambda row: (row.abs() > 0).sum(), axis=1) if not month_values.empty else pd.Series(0, index=df.index)
    )
    df["media_mensal_exec"] = [
        _safe_division(exec, months) if months else 0.0 for exec, months in zip(df["executado_total"], months_with_value)
    ]

    df["vigencia_str"] = df["vigencia"].dt.strftime("%d/%m/%Y").fillna("")
    return df


def _distribute_delta(series: pd.Series, delta: float) -> pd.Series:
    count = len(series)
    if count == 0:
        return series
    base_sum = series.sum()
    if not math.isclose(float(base_sum), 0.0, abs_tol=1e-9):
        weights = series / float(base_sum)
        return series + weights * delta
    increment = delta / count
    return series + increment


def _apply_scenario(
    df: pd.DataFrame,
    month_columns: Sequence[str],
    scenario: Optional[Dict[str, Any]],
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    if not scenario:
        return df, {"adjustments": [], "deltaPlanejado": 0.0, "deltaExecutado": 0.0, "deltaEmpenhado": 0.0}

    df = df.copy()
    adjustments = scenario.get("adjustments") or []
    summary = {"adjustments": [], "deltaPlanejado": 0.0, "deltaExecutado": 0.0, "deltaEmpenhado": 0.0}

    for adjustment in adjustments:
        ugr = str(adjustment.get("ugr") or "").strip()
        if not ugr:
            continue
        field = str(adjustment.get("field") or "total_estimado").lower()
        if field not in SUPPORTED_SCENARIO_FIELDS:
            field = "total_estimado"
        try:
            delta = float(adjustment.get("delta") or 0.0)
        except Exception:
            delta = 0.0
        if math.isclose(delta, 0.0, abs_tol=1e-9):
            continue

        mask = df["ugr"].astype(str).str.strip().str.lower() == ugr.lower()
        if not mask.any():
            continue

        summary_key = {
            "total_estimado": "deltaPlanejado",
            "executado_total": "deltaExecutado",
            "empenhado_total": "deltaEmpenhado",
        }[field]
        summary[summary_key] += delta

        if field == "executado_total" and month_columns:
            for key in month_columns:
                df.loc[mask, key] = _distribute_delta(df.loc[mask, key], delta / len(month_columns))
        df.loc[mask, field] = _distribute_delta(df.loc[mask, field], delta)

        summary["adjustments"].append({"ugr": ugr, "field": field, "delta": delta})

    df = _recompute_derived(df, month_columns)
    return df, summary


def _parse_filters(payload: Dict[str, Any]) -> Dict[str, List[str]]:
    filters = payload.get("filters") or {}
    parsed: Dict[str, List[str]] = {}
    for key in ("ugr", "pi", "descricao", "status", "cnpj", "month"):
        values = filters.get(key)
        if isinstance(values, list):
            parsed[key] = [str(value) for value in values if value not in (None, "")]
    return parsed


def _normalize_chart_mode(value: Optional[str]) -> str:
    if value and value.lower() == "ugr":
        return "ugr"
    return "total"


class DashboardManager:
    def __init__(self) -> None:
        self._datasets: Dict[str, DashboardDataset] = {}

    def reset(self) -> None:
        self._datasets.clear()

    def datasets(self) -> List[Dict[str, str]]:
        ordered = sorted(self._datasets.values(), key=lambda item: item.created_at, reverse=True)
        return [{"id": dataset.id, "name": dataset.name} for dataset in ordered]

    def remove(self, dataset_id: str) -> None:
        self._datasets.pop(dataset_id, None)

    def get(self, dataset_id: str) -> DashboardDataset:
        if not dataset_id:
            raise DashboardError("datasetId é obrigatório.")
        if dataset_id not in self._datasets:
            raise DashboardError("Dataset não encontrado ou expirado.")
        return self._datasets[dataset_id]

    def list_or_default(self, dataset_id: Optional[str]) -> DashboardDataset:
        if dataset_id:
            return self.get(dataset_id)
        if not self._datasets:
            raise DashboardError("Nenhuma base foi carregada.")
        latest = max(self._datasets.values(), key=lambda item: item.created_at)
        return latest

    def load_dataset(self, name: str, frame: pd.DataFrame) -> DashboardDataset:
        if frame.empty:
            raise DashboardError("A planilha enviada está vazia.")

        mapped, cleaned_frame, month_columns, metadata, warnings, column_map = self._prepare_dataset_frame(frame)
        mapped = _recompute_derived(mapped, month_columns)
        filters = _normalize_filters(mapped)

        dataset = DashboardDataset(
            id=str(uuid.uuid4()),
            name=name,
            frame=mapped,
            original_frame=cleaned_frame.copy(),
            month_columns=month_columns,
            month_metadata=metadata,
            filters=filters,
            warnings=warnings,
            column_map=column_map,
        )
        self._datasets[dataset.id] = dataset
        return dataset

    def _prepare_dataset_frame(
        self, frame: pd.DataFrame
    ) -> Tuple[pd.DataFrame, pd.DataFrame, List[str], List[MonthInfo], List[str], Dict[str, str]]:
        warnings: List[str] = []
        canonical = {}
        normalized_aliases = {key: {alias for alias in aliases} for key, aliases in COLUMN_ALIASES.items()}

        for column in frame.columns:
            normalized = _normalize_string(column)
            for canonical_name, aliases in normalized_aliases.items():
                if normalized in aliases and canonical_name not in canonical:
                    canonical[canonical_name] = column
                    break

        required = ["descricao", "ugr", "pi", "status", "total_estimado"]
        for field in required:
            if field not in canonical:
                warnings.append(f"Coluna '{field}' não foi localizada. Utilize os filtros para conferir os dados.")

        mapped = pd.DataFrame(index=frame.index)
        for key in COLUMN_ALIASES:
            source = canonical.get(key)
            if source is not None:
                if key in {"valor_mensal", "total_estimado", "saldo_empenhos", "saldo_rap", "total_rap_empenho"}:
                    mapped[key] = _coerce_numeric(frame[source])
                elif key == "vigencia":
                    mapped[key] = pd.to_datetime(frame[source], errors="coerce")
                else:
                    mapped[key] = frame[source].astype(str).fillna("").str.strip()
            else:
                if key in {"valor_mensal", "total_estimado", "saldo_empenhos", "saldo_rap", "total_rap_empenho"}:
                    mapped[key] = 0.0
                elif key == "vigencia":
                    mapped[key] = pd.NaT
                else:
                    mapped[key] = ""

        # Standardize status text
        mapped["status"] = mapped["status"].astype(str).str.strip()

        month_columns, metadata, month_warnings = _detect_month_columns(frame)
        warnings.extend(month_warnings)
        if not metadata:
            warnings.append("Colunas mensais não foram encontradas. Série temporal e heatmap ficarão vazios.")
        for info in metadata:
            mapped[info.key] = _coerce_numeric(frame[info.source]) if info.source in frame.columns else 0.0

        if "total_rap_empenho" not in mapped.columns:
            mapped["total_rap_empenho"] = 0.0
        if (
            mapped["total_rap_empenho"].abs().sum() == 0
            and ("saldo_empenhos" in mapped.columns or "saldo_rap" in mapped.columns)
        ):
            mapped["total_rap_empenho"] = (
                mapped.get("saldo_empenhos", 0.0).astype(float)
                + mapped.get("saldo_rap", 0.0).astype(float)
            )
        if "total_rap_empenho" not in frame.columns:
            frame["total_rap_empenho"] = mapped["total_rap_empenho"]
        else:
            try:
                frame["total_rap_empenho"] = pd.to_numeric(frame["total_rap_empenho"], errors="coerce").fillna(mapped["total_rap_empenho"])
            except Exception:
                frame["total_rap_empenho"] = mapped["total_rap_empenho"]

        summary_mask = mapped.apply(_is_summary_row, axis=1)
        if summary_mask.any():
            mapped = mapped.loc[~summary_mask].reset_index(drop=True)
            frame = frame.loc[~summary_mask].reset_index(drop=True)
        else:
            mapped = mapped.reset_index(drop=True)
            frame = frame.reset_index(drop=True)

        column_map: Dict[str, str] = {}
        for key in COLUMN_ALIASES.keys():
            column_map[key] = canonical.get(key, DEFAULT_LABELS.get(key, key))
        column_map.setdefault("executado_total", DEFAULT_LABELS.get("executado_total", "Executado Total"))
        column_map.setdefault("empenhado_total", DEFAULT_LABELS.get("empenhado_total", "Empenhado Total"))
        column_map.setdefault("saldo_previsto", DEFAULT_LABELS.get("saldo_previsto", "Saldo Previsto"))
        column_map.setdefault("execucao_pct", DEFAULT_LABELS.get("execucao_pct", "Execução (%)"))
        column_map.setdefault("media_mensal_exec", DEFAULT_LABELS.get("media_mensal_exec", "Média Mensal Executada"))

        return mapped, frame, month_columns, metadata, warnings, column_map

    def prepare_view(
        self,
        dataset_id: Optional[str],
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        dataset = self.list_or_default(dataset_id)
        filters = _parse_filters(payload)
        chart_mode = _normalize_chart_mode(payload.get("chartMode"))
        scenario = payload.get("scenario") or {}

        filtered_df = _apply_filters(dataset.frame, filters)
        scenario_df, scenario_summary = _apply_scenario(filtered_df, dataset.month_columns, scenario)

        month_filters = filters.get("month") or []

        kpis = _compute_kpis(scenario_df)
        alerts = _build_alerts(scenario_df, dataset.month_metadata)
        charts = _build_charts(scenario_df, dataset.month_metadata, month_filters, chart_mode)

        unit_breakdown = []
        if not dataset.frame.empty and 'ugr' in dataset.frame.columns:
            grouped = (
                dataset.frame.groupby('ugr', dropna=False)
                .agg({
                    'total_estimado': 'sum',
                    'executado_total': 'sum',
                    'empenhado_total': 'sum',
                    'saldo_previsto': 'sum',
                    'descricao': 'count'
                })
                .reset_index()
            )
            for _, row in grouped.iterrows():
                ugr_value = row['ugr']
                if pd.isna(ugr_value) or str(ugr_value).strip() == '':
                    ugr_label = 'Não informado'
                else:
                    ugr_label = str(ugr_value)
                unit_breakdown.append({
                    'ugr': ugr_label,
                    'totalEstimado': float(row.get('total_estimado', 0.0)),
                    'executadoTotal': float(row.get('executado_total', 0.0)),
                    'empenhadoTotal': float(row.get('empenhado_total', 0.0)),
                    'saldoPrevisto': float(row.get('saldo_previsto', 0.0)),
                    'quantidadeContratos': int(row.get('descricao', 0)),
                })

        raw_data = dataset.original_frame.head(200).fillna('').to_dict(orient='records')
        raw_columns = list(dataset.original_frame.columns.astype(str))

        table = _build_table(scenario_df, dataset.column_map)

        response = {
            "datasetId": dataset.id,
            "name": dataset.name,
            "datasets": self.datasets(),
            "generatedAt": datetime.utcnow().isoformat(),
            "warnings": dataset.warnings,
            "columnMap": dataset.column_map,
            "kpis": kpis,
            "alerts": alerts,
            "charts": charts,
            "table": table,
            "unitBreakdown": unit_breakdown,
            "rawData": raw_data,
            "rawColumns": raw_columns,
            "filterOptions": {**dataset.filters, "month": [{"key": info.key, "label": info.label} for info in dataset.month_metadata]},
            "scenario": scenario_summary,
        }
        return response

    def export(
        self,
        dataset_id: Optional[str],
        payload: Dict[str, Any],
        target: str,
        export_format: str,
    ) -> Tuple[io.BytesIO, str, str]:
        dataset = self.list_or_default(dataset_id)
        filters = _parse_filters(payload)
        scenario = payload.get("scenario") or {}

        filtered_df = _apply_filters(dataset.frame, filters)
        scenario_df, _ = _apply_scenario(filtered_df, dataset.month_columns, scenario)

        if target == "alerts":
            alerts = _build_alerts(scenario_df, dataset.month_metadata)
            df_export = pd.DataFrame(alerts)
            filename_base = "alertas"
        else:
            rows = _build_table(scenario_df)["rows"]
            df_export = pd.DataFrame(rows)
            filename_base = "tabela_detalhada"

        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        filename = f"{filename_base}_{timestamp}.{export_format}"

        if export_format == "csv":
            buffer = io.StringIO()
            df_export.to_csv(buffer, index=False)
            return io.BytesIO(buffer.getvalue().encode("utf-8")), filename, "text/csv"

        if export_format == "pdf":
            return self._export_pdf(df_export, filename_base, filename)

        if export_format == "png":
            return self._export_png(df_export, filename_base, filename)

        raise DashboardError("Formato de exportação inválido.")

    def _export_pdf(self, df: pd.DataFrame, title: str, filename: str) -> Tuple[io.BytesIO, str, str]:
        if df.empty:
            df = pd.DataFrame([{"Mensagem": "Nenhum dado disponível."}])
        pdf = FPDF(orientation="L", unit="mm", format="A4")
        pdf.add_page()
        pdf.set_font("Arial", "B", 14)
        pdf.cell(0, 10, title.replace("_", " ").title(), ln=True)
        pdf.ln(4)

        pdf.set_font("Arial", size=10)
        col_width = (pdf.w - 20) / max(len(df.columns), 1)
        for column in df.columns:
            pdf.cell(col_width, 8, str(column), border=1, align="C")
        pdf.ln()

        pdf.set_font("Arial", size=9)
        for _, row in df.iterrows():
            for column in df.columns:
                text = str(row[column])
                pdf.cell(col_width, 7, text[:40], border=1)
            pdf.ln()

        buffer = io.BytesIO(pdf.output(dest="S").encode("latin-1"))
        return buffer, filename, "application/pdf"

    def _export_png(self, df: pd.DataFrame, title: str, filename: str) -> Tuple[io.BytesIO, str, str]:
        if df.empty:
            df = pd.DataFrame([{"Mensagem": "Nenhum dado disponível."}])
        fig, ax = plt.subplots(figsize=(min(18, max(6, len(df.columns) * 1.2)), min(10, max(4, len(df) * 0.4))))
        ax.axis("off")
        table = ax.table(
            cellText=df.values,
            colLabels=df.columns,
            cellLoc="left",
            loc="center",
        )
        table.auto_set_font_size(False)
        table.set_fontsize(8)
        table.scale(1, 1.2)
        plt.title(title.replace("_", " ").title())
        buffer = io.BytesIO()
        plt.savefig(buffer, format="png", bbox_inches="tight")
        plt.close(fig)
        buffer.seek(0)
        return buffer, filename, "image/png"


def _as_number(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        if pd.isna(value):
            return 0.0
    except Exception:
        pass
    if hasattr(value, "item"):
        try:
            value = value.item()
        except Exception:
            pass
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _as_text(value: Any, *, with_time: bool = False) -> str:
    if value is None:
        return ""
    try:
        if pd.isna(value):
            return ""
    except Exception:
        pass
    if isinstance(value, pd.Timestamp):
        value = value.to_pydatetime()
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S" if with_time else "%Y-%m-%d")
    text = str(value).strip()
    if text.lower() in {"nan", "none", "null"}:
        return ""
    return text


def _row_delta_days(row: pd.Series) -> Optional[int]:
    vigencia = row.get("vigencia")
    if isinstance(vigencia, pd.Timestamp):
        return (vigencia.date() - datetime.utcnow().date()).days
    return None


def _row_status(row: pd.Series) -> str:
    return str(row.get("status") or "").strip().upper()


def build_unb_dashboard_payload(dataset: DashboardDataset) -> Dict[str, Any]:
    frame = dataset.frame.copy()
    metadata = dataset.month_metadata or []

    def sum_column(*columns: str) -> float:
        totals: List[float] = []
        for column in columns:
            if column is None or column not in frame.columns:
                continue
            series = frame[column]
            try:
                numeric = pd.to_numeric(series, errors="coerce")
            except Exception:
                numeric = pd.Series([_as_number(value) for value in series], index=series.index)
            total = float(numeric.fillna(0.0).sum())
            totals.append(total)
            if total != 0.0:
                return total
        return totals[-1] if totals else 0.0

    total_estimado = sum_column("total_estimado")
    total_comprometido = sum_column("total_rap_empenho", "empenhado_total", "total_empenho_rap")
    executado_total = sum_column("executado_total")
    if executado_total == 0.0 and metadata:
        for info in metadata:
            if info.key in frame.columns:
                executado_total += float(pd.to_numeric(frame[info.key], errors="coerce").fillna(0.0).sum())
    saldo_a_empenhar = max(total_estimado - executado_total, 0.0)
    percentual_execucao = _safe_division(executado_total, total_estimado) * 100.0

    expiring_records: List[Dict[str, Any]] = []
    expired_records: List[Dict[str, Any]] = []
    contract_records: List[Dict[str, Any]] = []

    def build_record(row: pd.Series) -> Dict[str, Any]:
        total_estimado = _as_number(row.get("total_estimado"))
        total_empenho_rap = _as_number(row.get("total_rap_empenho"))
        if not total_empenho_rap:
            total_empenho_rap = _as_number(row.get("saldo_empenhos")) + _as_number(row.get("saldo_rap"))
        executed_value = _as_number(row.get("executado_total"))
        if not executed_value:
            fallback_value = total_empenho_rap or _as_number(row.get("empenhado_total"))
            if not fallback_value:
                fallback_value = _as_number(row.get("saldo_empenhos")) + _as_number(row.get("saldo_rap"))
            executed_value = fallback_value

        comprometido_total = total_empenho_rap
        if not comprometido_total:
            comprometido_total = _as_number(row.get("empenhado_total")) or executed_value
        taxa_execucao = _as_number(row.get("execucao_pct"))
        if not taxa_execucao and total_estimado:
            taxa_execucao = _safe_division(executed_value, total_estimado) * 100.0

        record: Dict[str, Any] = {
            "Despesa": _as_text(row.get("descricao")),
            "UGR": _as_text(row.get("ugr")),
            "PI_2025": _as_text(row.get("pi")),
            "CNPJ": _as_text(row.get("cnpj")),
            "Processo": _as_text(row.get("processo")),
            "Data_Vigencia_Fim": _as_text(row.get("vigencia")),
            "Status_Contrato": _as_text(row.get("status")),
            "Situacao_Prorrogacao": _as_text(row.get("prorrogacao")),
            "nº  Contrato": _as_text(row.get("contrato")),
            "Valor_Mensal_Medio_Contrato": _as_number(row.get("valor_mensal")),
            "Valor_Mensal_Continuado": _as_number(row.get("valor_mensal_continuado")),
            "Total_Anual_Estimado": total_estimado,
            "Saldo_Empenhos_2025": _as_number(row.get("saldo_empenhos")),
            "Saldo_Empenhos_RAP": _as_number(row.get("saldo_rap")),
            "Total_Empenho_RAP": total_empenho_rap,
            "Executado_Total": executed_value,
            "Taxa_Execucao": taxa_execucao,
        }
        total_necessario = 0.0
        for info in metadata:
            month_value = _as_number(row.get(info.key))
            month_label = info.order.strftime("%Y-%m-%d 00:00:00")
            record[month_label] = month_value
            total_necessario += month_value
        record["Total_Necessario"] = total_necessario
        return record

    for _, row in frame.iterrows():
        if _is_summary_row(row):
            continue
        record = build_record(row)
        contract_records.append(record)
        delta = _row_delta_days(row)
        status = _row_status(row)
        if delta is not None and 0 <= delta <= LIMITE_DIAS_VENCIMENTO:
            expiring_records.append(record)
        elif delta is not None and delta < 0:
            expired_records.append(record)
        elif "VENC" in status and "VENCENDO" not in status:
            expired_records.append(record)

    ugr_analysis: List[Dict[str, Any]] = []
    if not frame.empty:
        grouped = frame.groupby("ugr", dropna=False)
        for ugr_value, group in grouped:
            total_ugr = float(group["total_estimado"].fillna(0.0).sum())
            executado_ugr = float(group["executado_total"].fillna(0.0).sum()) if "executado_total" in group else 0.0
            if executado_ugr == 0.0 and "total_rap_empenho" in group:
                executado_ugr = float(group["total_rap_empenho"].fillna(0.0).sum())
            comprometido_ugr = 0.0
            for column in ("total_rap_empenho", "empenhado_total", "total_empenho_rap"):
                if column in group:
                    comprometido_ugr = float(group[column].fillna(0.0).sum())
                    if comprometido_ugr:
                        break
            percent_exec = _safe_division(executado_ugr, total_ugr) * 100.0 if total_ugr else 0.0
            expired = 0
            active = 0
            for _, row in group.iterrows():
                delta = _row_delta_days(row)
                status = _row_status(row)
                if delta is not None and delta < 0:
                    expired += 1
                elif "VENC" in status and "VENCENDO" not in status:
                    expired += 1
                else:
                    active += 1
            ugr_analysis.append(
                {
                    "UGR": _as_text(ugr_value),
                    "Total_Anual_Estimado": total_ugr,
                    "Total_Empenho_RAP": executado_ugr,
                    "Executado_Total": executado_ugr,
                    "Comprometido_Total": comprometido_ugr,
                    "Contratos_Ativos": int(active),
                    "Contratos_Expirados": int(expired),
                    "Percentual_Execucao": percent_exec,
                }
            )

    monthly_consumption: List[Dict[str, Any]] = []
    for info in metadata:
        month_value = float(frame[info.key].fillna(0.0).sum()) if info.key in frame else 0.0
        monthly_consumption.append({"Mês": info.order.strftime("%Y-%m"), "Consumo_Mensal": month_value})

    payload = {
        "kpis": {
            "total_anual_estimado": total_estimado,
            "total_empenhado": executado_total,
            "total_comprometido": total_comprometido,
            "saldo_a_empenhar": saldo_a_empenhar,
            "percentual_execucao": percentual_execucao,
            "taxa_execucao": percentual_execucao,
            "count_expiring_contracts": len(expiring_records),
            "count_expired_contracts": len(expired_records),
        },
        "monthly_consumption": monthly_consumption,
        "ugr_analysis": ugr_analysis,
        "expiring_contracts_list": expiring_records,
        "expired_contracts_list": expired_records,
        "raw_data_for_filters": contract_records,
    }
    return payload
