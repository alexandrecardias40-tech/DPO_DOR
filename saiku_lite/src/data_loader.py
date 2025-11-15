"""Utilities to load tabular datasets from user uploads."""
from __future__ import annotations

import csv
import io
import json
import os
from typing import Optional

import pandas as pd


class DataLoaderError(RuntimeError):
    """Raised when an uploaded file cannot be parsed into a DataFrame."""


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

    if frame.empty:
        raise DataLoaderError("Arquivo lido, mas nenhum dado foi encontrado.")

    frame.columns = [str(col) for col in frame.columns]
    return frame

