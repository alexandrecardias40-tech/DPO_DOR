
import os
from pathlib import Path
from datetime import datetime
from werkzeug.utils import secure_filename
from data_versioning import create_version
from cpor_data_processing import (
    load_dashboard_data,
    process_dashboard_upload,
    save_dashboard_data,
    _load_relevant_dataframe,
    _extract_rows,
)

BASE_DIR = Path(__file__).resolve().parent
CPOR_UPLOAD_DIR = BASE_DIR / "uploads" / "cpor"

def store_cpor_upload(filename: str, data: bytes) -> Path:
    CPOR_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    sanitized = secure_filename(filename) or "cpor.xlsx"
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    target = CPOR_UPLOAD_DIR / f"{timestamp}-{sanitized}"
    target.write_bytes(data)
    return target

def _detect_file_type(file_bytes: bytes) -> str:
    """
    Detecta automaticamente o tipo de planilha enviada.
    
    Retorna:
      'base'   - Planilha de Despesas (tem colunas de mês → substitui tudo)
      'update' - BI / Tesouro Gerencial (sem colunas de mês → atualiza financeiro)
    """
    try:
        df = _load_relevant_dataframe(file_bytes)
        _, month_cols = _extract_rows(df)
        return "base" if month_cols else "update"
    except Exception:
        return "base"  # Em caso de dúvida, trata como nova base

def ingest_dashboard_spreadsheet(file_bytes: bytes, source_name: str) -> dict:
    """
    Processa um arquivo Excel de dashboard (CPOR), salva, cria versão e retorna resumo.

    Detecção automática de tipo de arquivo:
    - Planilha COM colunas de mês (ex: Planilha de Despesas) → NOVA BASE, substitui tudo
    - Planilha SEM colunas de mês (ex: BI Alexandre / Tesouro Gerencial) → ATUALIZAÇÃO,
      mescla apenas campos financeiros sobre a base existente
    """
    # Backup antes de alterar
    try:
        create_version(description=f"Backup automático antes de upload: {source_name}")
    except FileNotFoundError:
        pass  # Primeira vez, sem dados para backup

    file_type = _detect_file_type(file_bytes)

    if file_type == "base":
        # Planilha de Despesas → substitui toda a base, ignora dados anteriores
        print(f"[Upload] Tipo detectado: BASE (tem meses). Substituindo dados existentes. [{source_name}]")
        existing = None
    else:
        # BI / Tesouro Gerencial → mantém base, atualiza só financeiro
        print(f"[Upload] Tipo detectado: ATUALIZAÇÃO BI (sem meses). Mesclando sobre base. [{source_name}]")
        existing = load_dashboard_data()
        # Se não há dados na base, usa como base mesmo assim
        if not existing.get("raw_data_for_filters"):
            print("[Upload] Sem base existente no dashboard. BI tratada como base inicial.")
            existing = None

    payload = process_dashboard_upload(file_bytes, existing)
    save_dashboard_data(payload)
    upload_path = store_cpor_upload(source_name, file_bytes)

    # Versão após atualização bem-sucedida
    try:
        create_version(
            description=f"Atualização via upload ({file_type}): {source_name}",
            source_file=str(upload_path)
        )
    except Exception as e:
        print(f"Warning: Failed to create version after upload: {e}")

    return {
        "linhas_processadas": len(payload.get("raw_data_for_filters", [])),
        "ugr_mapeadas": len(payload.get("ugr_analysis", [])),
        "tipo_arquivo": file_type,
    }
