
import os
import base64
import json
import requests
from pathlib import Path
from datetime import datetime
from werkzeug.utils import secure_filename
from data_versioning import create_version
from cpor_data_processing import (
    load_dashboard_data,
    process_dashboard_upload,
    save_dashboard_data,
    DATA_PATH,
    _load_relevant_dataframe,
    _extract_rows,
)

BASE_DIR = Path(__file__).resolve().parent
CPOR_UPLOAD_DIR = BASE_DIR / "uploads" / "cpor"

# Caminho relativo do dashboard_data.json dentro do repositório GitHub
GITHUB_FILE_PATH = "unb-budget-dashboard/dashboard_data.json"


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


def _commit_dashboard_data_to_github(source_name: str) -> bool:
    """
    Commita o dashboard_data.json atualizado diretamente no GitHub via API.

    Requer as variáveis de ambiente:
      GITHUB_TOKEN  - Personal Access Token com permissão 'repo'
      GITHUB_REPO   - ex: 'alexandrecardias40-tech/DPO_DOR'

    Retorna True se bem-sucedido, False caso contrário.
    """
    token = os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPO", "alexandrecardias40-tech/DPO_DOR")

    if not token:
        print("[GitHub] GITHUB_TOKEN não configurado. Pulando commit automático.")
        return False

    if not DATA_PATH.exists():
        print("[GitHub] dashboard_data.json não encontrado. Pulando commit.")
        return False

    api_url = f"https://api.github.com/repos/{repo}/contents/{GITHUB_FILE_PATH}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    # 1. Pega o SHA atual do arquivo no GitHub (necessário para atualizar)
    try:
        resp = requests.get(api_url, headers=headers, timeout=15)
        if resp.status_code == 200:
            current_sha = resp.json().get("sha", "")
        elif resp.status_code == 404:
            current_sha = ""  # Arquivo novo
        else:
            print(f"[GitHub] Erro ao buscar SHA: {resp.status_code} {resp.text[:200]}")
            return False
    except Exception as e:
        print(f"[GitHub] Erro de conexão ao buscar SHA: {e}")
        return False

    # 2. Prepara o conteúdo em base64
    file_content = DATA_PATH.read_bytes()
    content_b64 = base64.b64encode(file_content).decode("utf-8")

    ts = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    commit_message = f"auto: atualiza dashboard_data.json via email [{source_name}] em {ts}"

    body: dict = {
        "message": commit_message,
        "content": content_b64,
        "branch": "main",
    }
    if current_sha:
        body["sha"] = current_sha

    # 3. Envia o commit
    try:
        resp = requests.put(api_url, headers=headers, json=body, timeout=30)
        if resp.status_code in (200, 201):
            commit_url = resp.json().get("commit", {}).get("html_url", "")
            print(f"[GitHub] ✅ dashboard_data.json commitado com sucesso! {commit_url}")
            return True
        else:
            print(f"[GitHub] ❌ Erro ao commitar: {resp.status_code} {resp.text[:300]}")
            return False
    except Exception as e:
        print(f"[GitHub] Erro de conexão ao commitar: {e}")
        return False


def ingest_dashboard_spreadsheet(
    file_bytes: bytes,
    source_name: str,
    sender_email: str = None,
    message_id: str = None,
) -> dict:
    """
    Processa um arquivo Excel de dashboard (CPOR), salva, cria versão e retorna resumo.

    Detecção automática de tipo de arquivo:
    - Planilha COM colunas de mês (ex: Planilha de Despesas) → NOVA BASE, substitui tudo
    - Planilha SEM colunas de mês (ex: BI Alexandre / Tesouro Gerencial) → ATUALIZAÇÃO,
      mescla apenas campos financeiros sobre a base existente

    Após salvar, commita o dashboard_data.json atualizado no GitHub automaticamente.
    Parâmetros:
      sender_email  - Email do remetente (exibido no tooltip do dashboard)
      message_id    - Message-ID do email (para evitar reprocessamento)
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

    payload = process_dashboard_upload(file_bytes, existing, sender_email=sender_email, source_file=source_name)
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

    # ── Auto-commit no GitHub ──────────────────────────────────────────────────
    # Commita o dashboard_data.json atualizado para que redeploys futuros
    # não percam os dados mais recentes.
    try:
        _commit_dashboard_data_to_github(source_name)
    except Exception as e:
        print(f"[GitHub] Erro inesperado no auto-commit: {e}")
    # ──────────────────────────────────────────────────────────────────────────

    return {
        "linhas_processadas": len(payload.get("raw_data_for_filters", [])),
        "ugr_mapeadas": len(payload.get("ugr_analysis", [])),
        "tipo_arquivo": file_type,
    }
