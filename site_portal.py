from __future__ import annotations

import os
from pathlib import Path
import sys
from typing import Dict, List, Optional, Tuple

import hmac
import json
from datetime import datetime

import requests
from flask import Flask, abort, jsonify, render_template, request, send_from_directory
from werkzeug.middleware.dispatcher import DispatcherMiddleware
from werkzeug.serving import run_simple
from werkzeug.utils import secure_filename

from cpor_data_processing import (
    load_dashboard_data,
    process_dashboard_upload,
    save_dashboard_data,
)

BASE_DIR = Path(__file__).resolve().parent
UNB_PUBLIC_DIR = BASE_DIR / "unb-budget-dashboard" / "dist" / "public"
CPOR_UPLOAD_DIR = BASE_DIR / "uploads" / "cpor"
SAIKU_LITE_DIR = Path(os.environ.get("SAIKU_LITE_PATH", str(BASE_DIR / "saiku_lite"))).resolve()


def _load_dash_apps() -> Tuple:
    try:
        os.environ["CAOR_DASH_BASEPATH"] = "/caor/"
        from caor_dashboard.app import app as caor_app
    except FileNotFoundError as exc:
        raise FileNotFoundError(
            "Planilhas base do dashboard CAOR não foram encontradas. "
            "Copie os arquivos Excel usados originalmente para a pasta raiz antes de iniciar o portal."
        ) from exc
    finally:
        os.environ.pop("CAOR_DASH_BASEPATH", None)

    try:
        os.environ["LOA_DASH_BASEPATH"] = "/loa/"
        from loa_dashboard.app import app as loa_app
    except FileNotFoundError as exc:
        raise FileNotFoundError(
            "O arquivo 'Limites LOA 2025 20.10.2025.xlsx' não foi localizado. "
            "Coloque-o na raiz do projeto ou informe outro caminho via upload pelo dashboard."
        ) from exc
    finally:
        os.environ.pop("LOA_DASH_BASEPATH", None)

    if not SAIKU_LITE_DIR.exists():
        raise FileNotFoundError(
            f"Diretório do Saiku Lite não encontrado em '{SAIKU_LITE_DIR}'. "
            "Ajuste a variável de ambiente SAIKU_LITE_PATH ou coloque a pasta ao lado do portal."
        )
    os.environ.setdefault("SAIKU_BASE_PATH", "/saiku")
    os.environ.setdefault("PORTAL_HOME_URL", "/")
    for candidate in (SAIKU_LITE_DIR, SAIKU_LITE_DIR.parent):
        # Add both the package directory and its parent so `saiku_lite` is importable.
        candidate_str = str(candidate)
        if candidate_str not in sys.path:
            sys.path.insert(0, candidate_str)
    try:
        from saiku_lite import create_app as create_saiku_app
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            "Não foi possível importar o Saiku Lite. Verifique se as dependências foram instaladas "
            "e se o pacote contém a função create_app."
        ) from exc
    saiku_app = create_saiku_app()

    return caor_app, loa_app, saiku_app


def _portal_entries() -> List[Dict[str, str]]:
    return [
        {
            "slug": "caor",
            "title": "Dashboard CAOR",
            "description": "Acompanhe crédito disponível, empenhos e destaques da Matriz.",
            "href": "/caor/",
            "accent": "#2563eb",
        },
        {
            "slug": "loa",
            "title": "Dashboard LOA 2025",
            "description": "Visualize limites, execução e notas de liquidação da LOA.",
            "href": "/loa/",
            "accent": "#0ea5e9",
        },
        {
            "slug": "cpor",
            "title": "Dashboard Execução Orçamentária",
            "description": "Análise de despesas e execução orçamentária.",
            "href": "/dashboard/",
            "accent": "#f97316",
        },
        {
            "slug": "BI",
            "title": "Business Intelligence",
            "description": "Monte análises estilo BI com tabelas dinâmicas rápidas.",
            "href": "/saiku/",
            "accent": "#a855f7",
        },
    ]


def _portal_user_profile() -> Dict[str, str]:
    name = os.getenv("PORTAL_USER_NAME")
    email = os.getenv("PORTAL_USER_EMAIL")
    if not name and not email:
        return {}
    return {
        "name": name or "",
        "email": email or "",
    }


def _store_cpor_upload(filename: str, data: bytes) -> None:
    CPOR_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    sanitized = secure_filename(filename) or "cpor.xlsx"
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    target = CPOR_UPLOAD_DIR / f"{timestamp}-{sanitized}"
    target.write_bytes(data)


def _ingest_dashboard_spreadsheet(file_bytes: bytes, source_name: str) -> Dict[str, int]:
    payload = process_dashboard_upload(file_bytes)
    save_dashboard_data(payload)
    _store_cpor_upload(source_name, file_bytes)
    return {
        "linhas_processadas": len(payload.get("raw_data_for_filters", [])),
        "ugr_mapeadas": len(payload.get("ugr_analysis", [])),
    }


def _drive_confirm_token(response: requests.Response) -> Optional[str]:
    for key, value in response.cookies.items():
        if key.startswith("download_warning"):
            return value
    return None


def _download_drive_file(file_id: str, *, timeout: int = 60) -> bytes:
    if not file_id:
        raise ValueError("ID do arquivo do Google Drive não foi informado.")
    session = requests.Session()
    base_url = "https://drive.google.com/uc?export=download"
    params = {"id": file_id}
    response = session.get(base_url, params=params, timeout=timeout)
    token = _drive_confirm_token(response)
    if token:
        params["confirm"] = token
        response = session.get(base_url, params=params, timeout=timeout)
    response.raise_for_status()
    if not response.content:
        raise RuntimeError("Download do Google Drive retornou um arquivo vazio.")
    return response.content


def _create_portal_app() -> Flask:
    template_dir = BASE_DIR / "site_templates"
    portal = Flask(__name__, static_folder=None, template_folder=str(template_dir))

    if not UNB_PUBLIC_DIR.exists():
        raise FileNotFoundError(
            f"Build directory '{UNB_PUBLIC_DIR}' não encontrado. Execute `pnpm --filter unb-budget-dashboard build`."
        )

    @portal.route("/")
    def index():
        return render_template("index.html", entries=_portal_entries())

    @portal.route("/dashboard/")
    def serve_dashboard_index():
        return send_from_directory(UNB_PUBLIC_DIR, "index.html")

    @portal.route("/dashboard/<path:asset_path>")
    def serve_dashboard_assets(asset_path: str):
        target = UNB_PUBLIC_DIR / asset_path
        if target.exists() and target.is_file():
            return send_from_directory(UNB_PUBLIC_DIR, asset_path)
        # SPA fallback
        return send_from_directory(UNB_PUBLIC_DIR, "index.html")

    @portal.route("/<path:spa_path>")
    def serve_dashboard_fallback(spa_path: str):
        protected_prefixes = ("api/", "caor", "loa", "saiku", "healthz", "uploads/")
        if any(spa_path.startswith(prefix) for prefix in protected_prefixes):
            abort(404)
        return send_from_directory(UNB_PUBLIC_DIR, "index.html")

    @portal.route("/healthz")
    def healthcheck():
        return {"status": "ok"}

    @portal.route("/api/dashboard/upload", methods=["POST"])
    def dashboard_upload():
        file = request.files.get("file")
        if file is None or not file.filename:
            return jsonify({"success": False, "message": "Selecione um arquivo Excel para enviar."}), 400
        try:
            file_bytes = file.read()
            summary = _ingest_dashboard_spreadsheet(file_bytes, file.filename)
            return jsonify(
                {
                    "success": True,
                    "message": f"Arquivo '{file.filename}' processado com sucesso.",
                    "summary": summary,
                }
            )
        except Exception as exc:
            return jsonify({"success": False, "message": str(exc)}), 400

    def _refresh_dashboard_from_drive() -> Dict[str, int]:
        file_id = os.environ.get("CPOR_DRIVE_FILE_ID")
        if not file_id:
            raise RuntimeError("Variável de ambiente CPOR_DRIVE_FILE_ID não foi configurada.")
        file_bytes = _download_drive_file(file_id)
        return _ingest_dashboard_spreadsheet(file_bytes, "drive_contracts.xlsx")

    @portal.route("/api/dashboard/refresh-drive", methods=["POST"])
    def dashboard_refresh_drive():
        if not os.environ.get("CPOR_DRIVE_FILE_ID"):
            return jsonify({"success": False, "message": "CPOR_DRIVE_FILE_ID não está configurada."}), 400

        expected_token = os.environ.get("CPOR_DRIVE_SYNC_TOKEN")
        if expected_token:
            provided = request.headers.get("X-Portal-Token") or request.args.get("token")
            if not provided or not hmac.compare_digest(provided, expected_token):
                return jsonify({"success": False, "message": "Token inválido."}), 403

        try:
            summary = _refresh_dashboard_from_drive()
            return jsonify({"success": True, "summary": summary})
        except Exception as exc:
            portal.logger.exception("Falha ao sincronizar dados do Google Drive")
            return jsonify({"success": False, "message": str(exc)}), 500

    drive_boot_flag = os.environ.get("CPOR_DRIVE_BOOT_SYNC", "1").strip().lower()
    if os.environ.get("CPOR_DRIVE_FILE_ID") and drive_boot_flag not in {"0", "false", "no", "off"}:
        try:
            summary = _refresh_dashboard_from_drive()
            portal.logger.info(
                "Planilha CPOR atualizada automaticamente do Google Drive (linhas=%s, ugr=%s)",
                summary.get("linhas_processadas"),
                summary.get("ugr_mapeadas"),
            )
        except Exception:
            portal.logger.exception("Falha ao atualizar planilha do Google Drive durante o boot")

    def _resolve_trpc_operation(operation: str, dataset: Dict[str, object]):
        if operation == "auth.me":
            return _portal_user_profile()
        if operation == "auth.logout":
            return {"success": True}
        if operation == "budget.getKPIs":
            return dataset.get("kpis", {})
        if operation == "budget.getAllData":
            return dataset.get("raw_data_for_filters", [])
        if operation == "budget.getUGRAnalysis":
            return dataset.get("ugr_analysis", [])
        if operation == "budget.getMonthlyConsumption":
            return dataset.get("monthly_consumption", [])
        if operation == "budget.getExpiringContracts":
            return dataset.get("expiring_contracts_list", [])
        if operation == "budget.getExpiredContracts":
            return dataset.get("expired_contracts_list", [])
        raise ValueError(f"Operação tRPC não suportada: {operation}")

    def _parse_trpc_input(raw_body: Optional[str], raw_query: Optional[str]) -> Dict[str, object]:
        payload: Dict[str, object] = {}
        raw_value = raw_query or raw_body
        if not raw_value:
            return payload
        try:
            parsed = json.loads(raw_value)
        except json.JSONDecodeError:
            return payload
        if isinstance(parsed, dict):
            return parsed
        if isinstance(parsed, list):
            return {str(idx): item for idx, item in enumerate(parsed)}
        return payload

    def _parse_trpc_body():
        try:
            return request.get_json(silent=True)
        except Exception:
            return None

    def _build_operations(paths: List[str], payload_map: Dict[str, object], body_payload) -> List[Dict[str, object]]:
        operations: List[Dict[str, object]] = []
        if isinstance(body_payload, list) and body_payload:
            for entry in body_payload:
                if not isinstance(entry, dict):
                    continue
                path = entry.get("path")
                if not path:
                    path = paths[0] if len(paths) == 1 else ""
                operations.append(
                    {
                        "path": path,
                        "input": entry.get("input") or entry.get("json"),
                        "id": entry.get("id"),
                    }
                )
            if operations:
                return operations
        for idx, path in enumerate(paths):
            payload = payload_map.get(str(idx)) if payload_map else {}
            if isinstance(payload, dict):
                input_data = payload.get("json", payload)
            else:
                input_data = payload
            operations.append({"path": path, "input": input_data, "id": idx})
        return operations

    @portal.route("/api/trpc", defaults={"paths": ""}, methods=["GET", "POST"])
    @portal.route("/api/trpc/<path:paths>", methods=["GET", "POST"])
    def trpc_handler(paths: str):
        path_segments = [segment.strip() for segment in (paths or "").split(",") if segment.strip()]
        if not path_segments:
            return jsonify({"error": "Nenhuma operação tRPC especificada."}), 400
        payload_map = _parse_trpc_input(
            request.get_data(as_text=True) if request.method == "POST" else None,
            request.args.get("input"),
        )
        body_payload = _parse_trpc_body() if request.method == "POST" else None
        operations = _build_operations(path_segments, payload_map, body_payload)
        dataset = load_dashboard_data()
        responses = []
        for entry in operations:
            operation = entry["path"]
            op_id = entry.get("id")
            try:
                result_data = _resolve_trpc_operation(operation, dataset)
                responses.append(
                    {
                        "jsonrpc": "2.0",
                        "result": {
                            "data": {
                                "json": result_data,
                            }
                        },
                        "id": op_id,
                    }
                )
            except Exception as exc:
                responses.append(
                    {
                        "jsonrpc": "2.0",
                        "error": {
                            "code": -32603,
                            "message": str(exc),
                        },
                        "id": op_id,
                    }
                )
        return jsonify(responses)

    return portal


def create_site_application() -> DispatcherMiddleware:
    caor_app, loa_app, saiku_app = _load_dash_apps()
    portal_app = _create_portal_app()

    return DispatcherMiddleware(
        portal_app,
        {
            "/caor": caor_app.server,
            "/loa": loa_app.server,
            "/saiku": saiku_app,
        },
    )


application = create_site_application()


def main() -> None:
    port = int(os.getenv("PORT", "8050"))
    threaded = os.getenv("PORTAL_THREADED", "1").strip().lower() in {"1", "true", "yes", "on"}
    run_simple(
        "0.0.0.0",
        port,
        application,
        use_reloader=True,
        use_debugger=False,
        threaded=threaded,
    )


if __name__ == "__main__":
    main()
