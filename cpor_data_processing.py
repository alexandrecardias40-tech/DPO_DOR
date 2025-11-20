from __future__ import annotations

import json
import re
from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import pandas as pd
from difflib import get_close_matches

BASE_DIR = Path(__file__).resolve().parent
DATA_PATH = BASE_DIR / "unb-budget-dashboard" / "dashboard_data.json"
FIXED_DATA_CANDIDATES = (
    "Varia01veis Fixas.xlsx",
    "Variáveis Fixas.xlsx",
    "Variaveis Fixas.xlsx",
)
MONTH_COLUMN_REGEX = re.compile(r"^\s*(20\d{2})[-_/]?(0[1-9]|1[0-2])")
MONTH_NAME_REGEX = re.compile(r"(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)", re.IGNORECASE)
MONTH_NAME_TO_NUM = {
    "jan": 1,
    "fev": 2,
    "mar": 3,
    "abr": 4,
    "mai": 5,
    "jun": 6,
    "jul": 7,
    "ago": 8,
    "set": 9,
    "out": 10,
    "nov": 11,
    "dez": 12,
}


def sanitize(text: str) -> str:
    normalized = (
        str(text)
        .strip()
        .lower()
    )
    normalized = normalized.replace("º", "o")
    return re.sub(r"[^a-z0-9]+", "_", normalized).strip("_")


FIELD_ALIASES: Dict[str, Sequence[str]] = {
"Despesa": (
    "despesa",
    "descricao",
    "descricao_despesa",
    "descricao_das_despesas",
    "descri_o_das_despesas",
    "historico",
    "item",
),
"UGR": ("ugr", "uorg", "uo", "unidade_gestora", "unidade_orcamentaria"),
"PI_2025": ("pi_2025", "pi", "plano_interno", "plano"),
"CNPJ": ("cnpj", "cnpj_cpf"),
"Processo": ("processo", "processo_sei", "numero_processo"),
"Data_Vigencia_Fim": ("data_vigencia_fim", "vigencia_final", "data_fim_vigencia", "vigencia", "vig_ncia"),
"Status_Contrato": ("status_contrato", "status", "situacao_contrato", "status_do_contrato"),
"Situacao_Prorrogacao": (
    "situacao_prorrogacao",
    "prorrogacao",
    "status_prorrogacao",
    "situacao_da_prorrogacao",
    "situacao_da_prorrogação",
    "situa_o_da_prorroga_o",
),
"nº  Contrato": ("numero_contrato", "n_contrato", "contrato", "num_contrato"),
"Valor_Mensal_Medio_Contrato": (
    "valor_mensal_medio_contrato",
    "valor_mensal",
    "valor_medio_mensal",
    "valor_contrato_media_mensal",
    "valor_contrato_medio_mensal",
    "valor_contrato_m_dia_mensal",
),
"Valor_Mensal_Continuado": ("valor_mensal_continuado", "valor_continuado", "valor_continuado_mensal", "valor_cont_continuado_mensal"),
"Total_Anual_Estimado": ("total_anual_estimado", "total_estimado", "estimado_anual", "total_estimado_anual"),
"Saldo_Empenhos_2025": ("saldo_empenhos_2025", "saldo_2025", "saldo_empenho_2025"),
"Saldo_Empenhos_RAP": ("saldo_empenhos_rap", "saldo_de_empenhos_rap", "saldo_rap"),
"Total_Empenho_RAP": ("total_empenho_rap", "valor_empenho_rap", "empenho_rap", "total_rap_empenho", "total_rap_mais_empenho"),
"Executado_Total": ("executado_total", "valor_executado", "executado"),
"Total_Necessario": ("total_necessario", "saldo_necessario"),
}

NUMERIC_FIELDS = {
    "Valor_Mensal_Medio_Contrato",
    "Valor_Mensal_Continuado",
    "Total_Anual_Estimado",
    "Saldo_Empenhos_2025",
    "Saldo_Empenhos_RAP",
    "Total_Empenho_RAP",
    "Executado_Total",
    "Total_Necessario",
}

DATE_FIELDS = {"Data_Vigencia_Fim"}
TEXT_FIELDS = set(FIELD_ALIASES.keys()) - NUMERIC_FIELDS - DATE_FIELDS
RESERVED_SANITIZED = {alias for seq in FIELD_ALIASES.values() for alias in seq}

FIXED_COLUMN_MAP = {
    "Descrição das despesas": "Despesa",
    "UGR": "UGR",
    "PI 2025": "PI_2025",
    "CNPJ": "CNPJ",
    "Processo": "Processo",
    "Vigência": "Data_Vigencia_Fim",
    "Status do Contrato": "Status_Contrato",
    "Situação da prorrogação": "Situacao_Prorrogacao",
    "nº  Contrato": "nº  Contrato",
    "Valor Contrato Média mensal": "Valor_Mensal_Medio_Contrato",
    "Valor Cont Continuado Mensal ": "Valor_Mensal_Continuado",
    "Total estimado Anual": "Total_Anual_Estimado",
    "Saldo Empenhos 2025": "Saldo_Empenhos_2025",
    "Saldo\nde Empenhos RAP": "Saldo_Empenhos_RAP",
    "Total RAP + Empenho": "Total_Empenho_RAP",
    "Total necessário": "Total_Necessario",
}

FIXED_NUMERIC_FIELDS = {
    "Valor_Mensal_Medio_Contrato",
    "Valor_Mensal_Continuado",
    "Total_Anual_Estimado",
    "Executado_Total",
    "Total_Necessario",
}

FIELDS_ONLY_FROM_DYNAMIC = {
    "Saldo_Empenhos_2025",
    "Saldo_Empenhos_RAP",
    "Total_Empenho_RAP",
}



def _default_payload() -> Dict[str, object]:
    return {
        "kpis": {
            "total_anual_estimado": 0.0,
            "total_empenhado": 0.0,
            "total_comprometido": 0.0,
            "saldo_a_empenhar": 0.0,
            "percentual_execucao": 0.0,
            "taxa_execucao": 0.0,
            "count_expiring_contracts": 0,
            "count_expired_contracts": 0,
        },
        "monthly_consumption": [],
        "ugr_analysis": [],
        "expiring_contracts_list": [],
        "expired_contracts_list": [],
        "raw_data_for_filters": [],
    }


def load_dashboard_data() -> Dict[str, object]:
    if not DATA_PATH.exists():
        return _default_payload()
    try:
        return json.loads(DATA_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return _default_payload()


def save_dashboard_data(payload: Dict[str, object]) -> None:
    DATA_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _resolve_fixed_path() -> Optional[Path]:
    for name in FIXED_DATA_CANDIDATES:
        path = BASE_DIR / name
        if path.exists():
            return path
    for candidate in BASE_DIR.glob("Varia*Fixas*.xlsx"):
        if candidate.exists():
            return candidate
    return None


def _load_fixed_dataframe() -> Optional[pd.DataFrame]:
    path = _resolve_fixed_path()
    if path is None:
        return None
    try:
        df = pd.read_excel(path, header=2)
    except Exception:
        return None
    if df.empty:
        return None
    rename: Dict[str, str] = {}
    for source, target in FIXED_COLUMN_MAP.items():
        rename[source] = target
    # handle datetime columns (months)
    for column in list(df.columns):
        if isinstance(column, (datetime, pd.Timestamp)):
            label = column.strftime("%Y-%m-%d")
            rename[column] = label
    df = df.rename(columns=rename)
    df = df.dropna(how="all")
    return df


class FixedLookup:
    def __init__(self, dataframe: Optional[pd.DataFrame]):
        self.by_pi: Dict[str, List[Dict[str, object]]] = {}
        self.by_combo: Dict[Tuple[str, str], Dict[str, object]] = {}
        self.by_contract: Dict[str, Dict[str, object]] = {}
        if dataframe is not None:
            self._build(dataframe)

    def has_data(self) -> bool:
        return bool(self.by_pi or self.by_contract)

    def _build(self, df: pd.DataFrame) -> None:
        for _, row in df.iterrows():
            record: Dict[str, object] = {}
            for target in FIXED_COLUMN_MAP.values():
                if target in row and pd.notna(row[target]):
                    record[target] = row[target]
            if not record:
                continue
            pi_key = _clean_key(record.get("PI_2025"))
            desc_key = _clean_key(record.get("Despesa"))
            contract_key = _clean_key(record.get("nº  Contrato"))
            if pi_key:
                self.by_pi.setdefault(pi_key, []).append(record)
                if desc_key:
                    self.by_combo[(pi_key, desc_key)] = record
            if contract_key:
                self.by_contract[contract_key] = record

    def match(self, row: Dict[str, object]) -> Optional[Dict[str, object]]:
        pi_key = _clean_key(row.get("PI_2025"))
        desc_key = _clean_key(row.get("Despesa"))
        contract_key = _clean_key(row.get("nº  Contrato"))
        if contract_key and contract_key in self.by_contract:
            return self.by_contract[contract_key]
        if pi_key:
            candidates = self.by_pi.get(pi_key)
            if not candidates:
                return None
            if len(candidates) == 1:
                return candidates[0]
            if desc_key and (pi_key, desc_key) in self.by_combo:
                return self.by_combo[(pi_key, desc_key)]
            return candidates[0]
        return None


def _clean_key(value: object) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text:
        return ""
    # remove observações entre parênteses ou após quebras de linha
    text = text.split("\n")[0]
    if "(" in text and ")" in text:
        text = text.split("(", 1)[0]
    return sanitize(text)


def _format_column_name(value) -> str:
    if isinstance(value, (datetime, pd.Timestamp)):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value).strip()


def _score_columns(columns: Sequence[str]) -> int:
    resolver = ColumnResolver(columns)
    score = 0
    for aliases in FIELD_ALIASES.values():
        if resolver.find(aliases):
            score += 1
    return score


def _load_relevant_dataframe(file_bytes: bytes) -> pd.DataFrame:
    excel = pd.ExcelFile(BytesIO(file_bytes))
    best_df: Optional[pd.DataFrame] = None
    best_score = -1
    for sheet in excel.sheet_names:
        raw = excel.parse(sheet, header=None)
        if raw.empty:
            continue
        limit = min(20, len(raw))
        for header_idx in range(limit):
            header_row = raw.iloc[header_idx].fillna("").astype(str).tolist()
            score = _score_columns(header_row)
            if score == 0:
                continue
            data = raw.iloc[header_idx + 1 :].copy()
            if data.empty:
                continue
            header = []
            used = {}
            for value in header_row:
                label = value.strip()
                if not label:
                    label = f"col_{len(header)+1}"
                key = sanitize(label)
                count = used.get(key, 0)
                used[key] = count + 1
                if count:
                    label = f"{label}_{count+1}"
                header.append(label)
            data.columns = header
            data = data.dropna(how="all")
            if data.empty:
                continue
            better_len = len(data)
            current_len = len(best_df) if isinstance(best_df, pd.DataFrame) else -1
            if score > best_score or (score == best_score and better_len > current_len):
                best_df = data.copy()
                best_score = score
                if score == len(FIELD_ALIASES):
                    break
        if best_score == len(FIELD_ALIASES):
            break
    if best_df is None:
        raise ValueError(
            "Não foi possível identificar colunas obrigatórias (Despesa, UGR, valores etc.) na planilha enviada."
        )
    return best_df


class ColumnResolver:
    def __init__(self, columns: Iterable[str]):
        self.lookup: Dict[str, str] = {}
        self.columns: List[str] = []
        for col in columns:
            self.columns.append(str(col))
            key = sanitize(col)
            if key and key not in self.lookup:
                self.lookup[key] = str(col)

    def find(self, aliases: Sequence[str]) -> Optional[str]:
        sanitized_aliases = [sanitize(alias) for alias in aliases if sanitize(alias)]
        for alias in sanitized_aliases:
            if alias in self.lookup:
                return self.lookup[alias]
        for alias in sanitized_aliases:
            matches = get_close_matches(alias, list(self.lookup.keys()), n=1, cutoff=0.55)
            if matches:
                return self.lookup[matches[0]]
        for alias in sanitized_aliases:
            for key, value in self.lookup.items():
                if alias in key or key in alias:
                    return value
        return None


def _normalize_number(value) -> float:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = (
            value.replace("R$", "")
            .replace("%", "")
            .replace(" ", "")
            .replace("\u00a0", "")
        )
        if cleaned.count(",") > 0 and cleaned.count(".") > 0:
            if cleaned.rfind(",") > cleaned.rfind("."):
                cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", ".")
        cleaned = re.sub(r"[^0-9\-.]", "", cleaned)
        if not cleaned:
            return 0.0
        try:
            return float(cleaned)
        except ValueError:
            return 0.0
    return float(value)


def _normalize_text(value) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()


def _normalize_date(value) -> str:
    if value in (None, ""):
        return ""
    if isinstance(value, (datetime, pd.Timestamp)):
        return value.date().isoformat()
    try:
        parsed = pd.to_datetime(value, errors="coerce")
        if pd.isna(parsed):
            return ""
        return parsed.date().isoformat()
    except Exception:
        return ""


def _detect_month_columns(columns: Sequence[str]) -> List[Tuple[str, str]]:
    detected: List[Tuple[str, str]] = []
    for col in columns:
        label = _format_column_name(col)
        if sanitize(label) in RESERVED_SANITIZED:
            continue
        normalized = _normalize_month_key(label)
        if normalized is None:
            continue
        detected.append((normalized, label))
    seen = set()
    ordered: List[Tuple[str, str]] = []
    for normalized, original in detected:
        if normalized not in seen:
            ordered.append((normalized, original))
            seen.add(normalized)
    return ordered


def _normalize_month_key(key: str) -> Optional[str]:
    parsed = pd.to_datetime(key, errors="coerce")
    if pd.isna(parsed):
        match = MONTH_COLUMN_REGEX.match(key)
        if match:
            year, month = match.groups()
            parsed = pd.Timestamp(year=int(year), month=int(month), day=1)
        else:
            name_match = MONTH_NAME_REGEX.search(key)
            year_match = re.search(r"(20\d{2})", key)
            if name_match and year_match:
                month_num = MONTH_NAME_TO_NUM.get(name_match.group(1).lower())
                year = int(year_match.group(1))
                if month_num:
                    parsed = pd.Timestamp(year=year, month=month_num, day=1)
            else:
                return None
    return parsed.strftime("%Y-%m-%d 00:00:00")


def _extract_rows(df: pd.DataFrame) -> Tuple[List[Dict[str, object]], List[str]]:
    df = df.copy()
    df.columns = [_format_column_name(col) for col in df.columns]
    resolver = ColumnResolver(df.columns)
    month_columns = _detect_month_columns(df.columns)
    rows: List[Dict[str, object]] = []
    for _, series in df.iterrows():
        record: Dict[str, object] = {}
        for target, aliases in FIELD_ALIASES.items():
            column_name = resolver.find(aliases)
            value = series.get(column_name) if column_name else None
            if target in NUMERIC_FIELDS:
                record[target] = _normalize_number(value)
            elif target in DATE_FIELDS:
                record[target] = _normalize_date(value)
            else:
                record[target] = _normalize_text(value)
        for normalized_key, original_label in month_columns:
            source_column = original_label
            if source_column not in series.index:
                fallback = resolver.find([original_label])
                if fallback:
                    source_column = fallback
            value = series.get(source_column) if source_column in series.index else None
            record[normalized_key] = _normalize_number(value)
        rows.append(record)
    normalized_months = [key for key, _ in month_columns]
    return rows, normalized_months


def _normalize_token(value: Optional[str]) -> str:
    if value is None:
        return ""
    return sanitize(value)


def _should_discard(row: Dict[str, object]) -> bool:
    description = _normalize_token(row.get("Despesa"))
    ugr = _normalize_token(row.get("UGR"))
    pi = _normalize_token(row.get("PI_2025"))
    if not description:
        return False
    if description in {"total", "total_geral"}:
        return True
    if description.startswith("total_da") or description.startswith("total_de"):
        return True
    if description.startswith("total") and not ugr:
        return True
    if not description and not ugr and not pi:
        return True
    return False


def _sum_month_values(row: Dict[str, object], month_keys: Sequence[str]) -> float:
    return sum(_normalize_number(row.get(month, 0.0)) for month in month_keys)


def _normalize_row(row: Dict[str, object], month_keys: Sequence[str]) -> Dict[str, object]:
    normalized = row.copy()
    total_estimado = _normalize_number(row.get("Total_Anual_Estimado"))
    executado_informado = _normalize_number(row.get("Executado_Total"))
    empenho_rap = _normalize_number(row.get("Total_Empenho_RAP"))
    saldo25 = _normalize_number(row.get("Saldo_Empenhos_2025"))
    saldo_rap = _normalize_number(row.get("Saldo_Empenhos_RAP"))
    meses = _sum_month_values(row, month_keys)
    comprometido = empenho_rap if empenho_rap else saldo25 + saldo_rap
    executado = executado_informado or meses or comprometido
    taxa_execucao = (executado / total_estimado * 100) if total_estimado else 0.0
    normalized["Total_Empenho_RAP"] = comprometido
    normalized["Executado_Total"] = executado
    normalized["Taxa_Execucao"] = taxa_execucao
    return normalized


def _build_monthly_consumption(rows: Sequence[Dict[str, object]], month_keys: Sequence[str]) -> List[Dict[str, object]]:
    totals = {key: 0.0 for key in month_keys}
    for row in rows:
        for key in month_keys:
            totals[key] += _normalize_number(row.get(key, 0.0))
    result = []
    for key in sorted(month_keys):
        parsed = pd.to_datetime(key, errors="coerce")
        label = parsed.strftime("%Y-%m") if pd.notna(parsed) else key[:7]
        result.append({"Mês": label, "Consumo_Mensal": totals[key]})
    return result


def _parse_vigencia(value: object) -> Optional[date]:
    if not value:
        return None
    try:
        parsed = pd.to_datetime(value, errors="coerce")
    except Exception:
        parsed = pd.NaT
    if pd.isna(parsed):
        return None
    return parsed.date()


def _build_ugr_analysis(rows: Sequence[Dict[str, object]]) -> List[Dict[str, object]]:
    today = date.today()
    bucket: Dict[str, Dict[str, object]] = {}
    for row in rows:
        key = row.get("UGR") or "Não informado"
        stats = bucket.setdefault(
            key,
            {
                "UGR": key,
                "Total_Anual_Estimado": 0.0,
                "Total_Empenho_RAP": 0.0,
                "Executado_Total": 0.0,
                "Comprometido_Total": 0.0,
                "Contratos_Ativos": 0,
                "Contratos_Expirados": 0,
                "Percentual_Execucao": 0.0,
            },
        )
        total_estimado = _normalize_number(row.get("Total_Anual_Estimado"))
        executado = _normalize_number(row.get("Executado_Total"))
        comprometido = _normalize_number(row.get("Total_Empenho_RAP"))
        if not comprometido:
            comprometido = (
                _normalize_number(row.get("Saldo_Empenhos_2025")) +
                _normalize_number(row.get("Saldo_Empenhos_RAP"))
            )
        stats["Total_Anual_Estimado"] += total_estimado
        stats["Executado_Total"] += executado
        stats["Total_Empenho_RAP"] += comprometido
        stats["Comprometido_Total"] += comprometido

        status = str(row.get("Status_Contrato") or "").upper()
        vigencia = _parse_vigencia(row.get("Data_Vigencia_Fim"))
        expired = False
        if vigencia:
            expired = vigencia < today
        elif "VENC" in status and "VENCENDO" not in status:
            expired = True
        if expired:
            stats["Contratos_Expirados"] += 1
        else:
            stats["Contratos_Ativos"] += 1

    for stats in bucket.values():
        total = stats["Total_Anual_Estimado"]
        exec_total = stats["Executado_Total"]
        stats["Percentual_Execucao"] = (exec_total / total * 100) if total else 0.0
    return list(bucket.values())


def _build_kpis(rows: Sequence[Dict[str, object]]) -> Dict[str, object]:
    total_estimado = sum(_normalize_number(r.get("Total_Anual_Estimado")) for r in rows)
    executado = sum(_normalize_number(r.get("Executado_Total")) for r in rows)
    comprometido = 0.0
    for row in rows:
        rap = _normalize_number(row.get("Total_Empenho_RAP"))
        saldo = _normalize_number(row.get("Saldo_Empenhos_2025")) + _normalize_number(row.get("Saldo_Empenhos_RAP"))
        comprometido += rap if rap else saldo
    saldo = max(total_estimado - executado, 0.0)
    percentual = (executado / total_estimado * 100) if total_estimado else 0.0
    today = date.today()
    expiring = 0
    expired = 0
    for row in rows:
        vigencia = _parse_vigencia(row.get("Data_Vigencia_Fim"))
        status = str(row.get("Status_Contrato") or "").upper()
        if vigencia:
            diff = (vigencia - today).days
            if 0 <= diff <= 60:
                expiring += 1
            elif diff < 0:
                expired += 1
        elif "VENC" in status and "VENCENDO" not in status:
            expired += 1
    return {
        "total_anual_estimado": total_estimado,
        "total_empenhado": executado,
        "total_comprometido": comprometido,
        "saldo_a_empenhar": saldo,
        "percentual_execucao": percentual,
        "taxa_execucao": percentual,
        "count_expiring_contracts": expiring,
        "count_expired_contracts": expired,
    }


def _split_contracts(rows: Sequence[Dict[str, object]]) -> Tuple[List[Dict[str, object]], List[Dict[str, object]]]:
    today = date.today()
    expiring: List[Dict[str, object]] = []
    expired: List[Dict[str, object]] = []
    for row in rows:
        vigencia = _parse_vigencia(row.get("Data_Vigencia_Fim"))
        status = str(row.get("Status_Contrato") or "").upper()
        target = None
        if vigencia:
            diff = (vigencia - today).days
            if diff < 0:
                target = expired
            elif diff <= 60:
                target = expiring
        elif "VENC" in status and "VENCENDO" not in status:
            target = expired
        if target is not None:
            target.append(row.copy())
    return expiring, expired


def _merge_fixed_row(row: Dict[str, object], lookup: FixedLookup) -> Dict[str, object]:
    fixed = lookup.match(row)
    if not fixed:
        return row
    merged = row.copy()
    for field, value in fixed.items():
        if field in {"Despesa", "PI_2025"}:
            continue
        if field in FIELDS_ONLY_FROM_DYNAMIC:
            continue
        if value is None or (isinstance(value, float) and pd.isna(value)):
            continue
        if field in FIXED_NUMERIC_FIELDS:
            merged[field] = _normalize_number(value)
        else:
            merged[field] = value
    return merged


def process_dashboard_upload(file_bytes: bytes) -> Dict[str, object]:
    if not file_bytes:
        raise ValueError("Arquivo vazio.")
    df = _load_relevant_dataframe(file_bytes)
    if df.empty:
        raise ValueError("Nenhuma linha encontrada na planilha.")
    raw_rows, month_columns = _extract_rows(df)
    fixed_lookup = FixedLookup(_load_fixed_dataframe())
    if fixed_lookup.has_data():
        raw_rows = [_merge_fixed_row(row, fixed_lookup) for row in raw_rows]
    filtered = [
        _normalize_row(row, month_columns)
        for row in raw_rows
        if not _should_discard(row)
    ]
    if not filtered:
        raise ValueError("Não foi possível identificar registros válidos na planilha.")
    kpis = _build_kpis(filtered)
    ugr_analysis = _build_ugr_analysis(filtered)
    monthly = _build_monthly_consumption(filtered, month_columns)
    expiring, expired = _split_contracts(filtered)
    payload = {
        "kpis": kpis,
        "monthly_consumption": monthly,
        "ugr_analysis": ugr_analysis,
        "expiring_contracts_list": expiring,
        "expired_contracts_list": expired,
        "raw_data_for_filters": filtered,
    }
    return payload


__all__ = [
    "DATA_PATH",
    "load_dashboard_data",
    "save_dashboard_data",
    "process_dashboard_upload",
]
