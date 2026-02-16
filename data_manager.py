
import os
from pathlib import Path
from datetime import datetime
from werkzeug.utils import secure_filename
from data_versioning import create_version
from cpor_data_processing import (
    load_dashboard_data,
    process_dashboard_upload,
    save_dashboard_data,
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

def ingest_dashboard_spreadsheet(file_bytes: bytes, source_name: str) -> dict:
    """
    Processa um arquivo Excel de dashboard (CPOR), salva, cria versão e retorna resumo.
    """
    # Criar versão antes de atualizar (backup automático)
    try:
        create_version(description=f"Backup automático antes de upload: {source_name}")
    except FileNotFoundError:
        pass  # Primeira vez, não há dados para fazer backup
    
    existing = load_dashboard_data()
    payload = process_dashboard_upload(file_bytes, existing)
    save_dashboard_data(payload)
    upload_path = store_cpor_upload(source_name, file_bytes)
    
    # Criar versão após atualização bem-sucedida
    try:
        create_version(
            description=f"Atualização via upload: {source_name}",
            source_file=str(upload_path)
        )
    except Exception as e:
        print(f"Warning: Failed to create version after upload: {e}")
    
    return {
        "linhas_processadas": len(payload.get("raw_data_for_filters", [])),
        "ugr_mapeadas": len(payload.get("ugr_analysis", [])),
    }
