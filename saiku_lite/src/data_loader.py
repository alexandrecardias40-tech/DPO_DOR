"""Utilities to load tabular datasets from user uploads."""
from __future__ import annotations

import csv
import io
import json
import os
from typing import Any, Dict, Optional

import pandas as pd


class DataLoaderError(RuntimeError):
    """Raised when an uploaded file cannot be parsed into a DataFrame."""


def _is_placeholder_header(name: Any) -> bool:
    text = str(name or "").strip().lower()
    return not text or text.startswith("unnamed")


def _clean_header_value(value: Any, position: int) -> str:
    if value is None or pd.isna(value):
        return f"col_{position}"
    text = str(value).strip()
    return text or f"col_{position}"


def _find_header_row(frame: pd.DataFrame, max_scan: int = 5) -> Optional[int]:
    if frame.empty:
        return None
    total_cols = len(frame.columns)
    if total_cols == 0:
        return None
    placeholder_count = sum(1 for col in frame.columns if _is_placeholder_header(col))
    if placeholder_count < max(1, total_cols // 2):
        return None
    scan_limit = min(max_scan, len(frame))
    required_non_empty = max(1, int(total_cols * 0.5))
    for idx in range(scan_limit):
        row = frame.iloc[idx]
        non_empty = 0
        for value in row:
            if value is None or pd.isna(value):
                continue
            text = str(value).strip()
            if text:
                non_empty += 1
        if non_empty >= required_non_empty:
            return idx
    return None


def _promote_row_to_header(frame: pd.DataFrame, row_index: int) -> pd.DataFrame:
    header_series = frame.iloc[row_index]
    seen: Dict[str, int] = {}
    new_columns = []
    for position, value in enumerate(header_series, start=1):
        base = _clean_header_value(value, position)
        count = seen.get(base, 0)
        name = f"{base}_{count + 1}" if count else base
        seen[base] = count + 1
        new_columns.append(name)
    remaining = frame.iloc[row_index + 1 :].copy()
    if remaining.empty:
        remaining = pd.DataFrame(columns=new_columns)
    else:
        remaining.columns = new_columns
    return remaining.reset_index(drop=True)


def _ensure_headers(frame: pd.DataFrame) -> pd.DataFrame:
    header_row = _find_header_row(frame)
    if header_row is None:
        return frame
    return _promote_row_to_header(frame, header_row)


def _detect_delimiter(sample: str) -> str:
    """Attempt to detect the delimiter used inside a text sample."""
    candidates = [',', ';', '\t', '|', ':']
    try:
        sniffer = csv.Sniffer()
        dialect = sniffer.sniff(sample, delimiters=''.join(candidates))
        delimiter = getattr(dialect, 'delimiter', None)
        if delimiter:
            return delimiter
    except (csv.Error, TypeError):
        pass

    counts = {delim: sample.count(delim) for delim in candidates}
    fallback = max(counts, key=counts.get)
    if counts.get(fallback, 0) > 0:
        return fallback
    return ','


def _read_text_dataframe(content: bytes, delimiter: Optional[str] = None) -> pd.DataFrame:
    text = content.decode('utf-8', errors='ignore')
    sample = text[:4096]
    sep = delimiter or _detect_delimiter(sample)
    return pd.read_csv(io.StringIO(text), sep=sep)


def _read_json_dataframe(content: bytes) -> pd.DataFrame:
    payload = json.loads(content.decode("utf-8"))
    if isinstance(payload, list):
        return pd.DataFrame(payload)
    if isinstance(payload, dict):
        if "data" in payload and isinstance(payload["data"], list):
            return pd.DataFrame(payload["data"])
        return pd.json_normalize(payload)
    raise DataLoaderError("Formato JSON não suportado: é necessário um array de objetos ou campo 'data'.")


def load_dataframe(filename: str, file_content: bytes) -> pd.DataFrame:
    """Return a DataFrame for the uploaded file content."""
    if not filename:
        raise DataLoaderError("Arquivo sem nome não pôde ser processado.")

    ext = os.path.splitext(filename)[1].lower()

    try:
        if ext in {".csv", ".txt"}:
            frame = _read_text_dataframe(file_content)
        elif ext in {".tsv", ".tab"}:
            frame = _read_text_dataframe(file_content, delimiter="\t")
        elif ext in {".xls", ".xlsx"}:
            frame = pd.read_excel(io.BytesIO(file_content))
        elif ext == ".json":
            frame = _read_json_dataframe(file_content)
        else:
            raise DataLoaderError(f"Extensão de arquivo '{ext}' não é suportada.")
    except UnicodeDecodeError as exc:
        raise DataLoaderError("Erro de decodificação de texto. Verifique a codificação do arquivo.") from exc
    except ValueError as exc:
        raise DataLoaderError(str(exc)) from exc
    except Exception as exc:
        raise DataLoaderError(f"Não foi possível processar o arquivo: {exc}") from exc

    frame = _ensure_headers(frame)

    if frame.empty:
        raise DataLoaderError("Arquivo lido, mas nenhum dado foi encontrado.")

    frame.columns = [str(col) for col in frame.columns]
    return frame
