from __future__ import annotations

import os
from pathlib import Path
import sys
from typing import Dict, List, Optional, Tuple

import hmac
import json
from datetime import datetime

import requests
import base64
from flask import Flask, abort, jsonify, render_template, request, send_from_directory
from werkzeug.middleware.dispatcher import DispatcherMiddleware
from werkzeug.serving import run_simple
from werkzeug.utils import secure_filename

# Import CPOR processing logic
from cpor_data_processing import (
    load_dashboard_data,
    process_dashboard_upload,
    save_dashboard_data,
)

BASE_DIR = Path(__file__).resolve().parent
# CPOR Static files copied to static/cpor/public
UNB_PUBLIC_DIR = BASE_DIR / "static" / "cpor" / "public"
CPOR_UPLOAD_DIR = BASE_DIR / "uploads" / "cpor"
# Saiku Lite copied to saiku_lite/
SAIKU_LITE_DIR = Path(os.environ.get("SAIKU_LITE_PATH", str(BASE_DIR / "saiku_lite"))).resolve()

def _load_apps() -> Tuple:
    if not SAIKU_LITE_DIR.exists():
        # Fallback or error
        print(f"Warning: Saiku Lite directory not found at {SAIKU_LITE_DIR}")
        return None

    os.environ.setdefault("SAIKU_BASE_PATH", "/saiku")
    
    if str(SAIKU_LITE_DIR) not in sys.path:
        sys.path.insert(0, str(SAIKU_LITE_DIR))
    if str(SAIKU_LITE_DIR.parent) not in sys.path:
        sys.path.insert(0, str(SAIKU_LITE_DIR.parent))

    try:
        from saiku_lite import create_app as create_saiku_app
        return create_saiku_app()
    except Exception as e:
        print(f"Error loading Saiku Lite: {e}")
        return None

def _portal_entries() -> List[Dict[str, str]]:
    return [
        {
            "slug": "cpor",
            "title": "Dashboard Execução Orçamentária",
            "description": "Análise de despesas e execução orçamentária.",
            "href": "/dashboard/",
            "accent": "#f97316",
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

# --- Shared Logic Copy (for Uploads) ---
def _store_cpor_upload(filename: str, data: bytes) -> None:
    CPOR_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    sanitized = secure_filename(filename) or "cpor.xlsx"
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    target = CPOR_UPLOAD_DIR / f"{timestamp}-{sanitized}"
    target.write_bytes(data)

def _ingest_dashboard_spreadsheet(file_bytes: bytes, source_name: str) -> Dict[str, int]:
    existing = load_dashboard_data()
    payload = process_dashboard_upload(file_bytes, existing)
    save_dashboard_data(payload)
    _store_cpor_upload(source_name, file_bytes)
    return {
        "linhas_processadas": len(payload.get("raw_data_for_filters", [])),
        "ugr_mapeadas": len(payload.get("ugr_analysis", [])),
    }

def _create_portal_app() -> Flask:
    template_dir = BASE_DIR / "templates"
    portal = Flask(__name__, static_folder=None, template_folder=str(template_dir))

    @portal.route("/")
    def index():
        return render_template("index.html", entries=_portal_entries())

    # --- Serving React App (CPOR) ---
    @portal.route("/dashboard/")
    def serve_dashboard_index():
        if not UNB_PUBLIC_DIR.exists():
             return "Dashboard build not found. Please run build.", 404
        return send_from_directory(UNB_PUBLIC_DIR, "index.html")

    @portal.route("/dashboard/<path:asset_path>")
    def serve_dashboard_assets(asset_path: str):
        target = UNB_PUBLIC_DIR / asset_path
        if target.exists() and target.is_file():
            return send_from_directory(UNB_PUBLIC_DIR, asset_path)
        return send_from_directory(UNB_PUBLIC_DIR, "index.html")

    @portal.route("/assets/<path:asset_path>")
    def serve_public_assets(asset_path: str):
        # Vite assets are often in assets/
        target = UNB_PUBLIC_DIR / "assets" / asset_path
        if target.exists() and target.is_file():
             return send_from_directory(UNB_PUBLIC_DIR / "assets", asset_path)
        return "Asset not found", 404



    # --- TRPC for CPOR ---
    def _resolve_trpc_operation(operation: str, dataset: Dict[str, object], input_data: Optional[Dict] = None):
        if operation == "auth.me":
            return _portal_user_profile()
        if operation == "auth.logout":
            return {"success": True}
        if operation == "budget.getKPIs":
            return dataset.get("kpis", {})
        if operation == "budget.getAllData":
            return dataset.get("raw_data_for_filters", [])
        if operation == "budget.getMetadata":
            return dataset.get("metadata", {})
        if operation == "budget.getUGRAnalysis":
            return dataset.get("ugr_analysis", [])
        if operation == "budget.getMonthlyConsumption":
            return dataset.get("monthly_consumption", [])
        if operation == "budget.getExpiringContracts":
            return dataset.get("expiring_contracts_list", [])
        if operation == "budget.getExpiredContracts":
            return dataset.get("expired_contracts_list", [])
        
        if operation == "budget.uploadFile":
            if not input_data:
                raise ValueError("Input data missing for uploadFile")
            
            content_base64 = input_data.get("contentBase64")
            file_name = input_data.get("fileName", "upload.xlsx")
            
            if not content_base64:
                 return {"success": False, "message": "Arquivo vazio"}
            
            try:
                file_bytes = base64.b64decode(content_base64)
                # Parse and save
                existing = load_dashboard_data()
                payload = process_dashboard_upload(file_bytes, existing)
                save_dashboard_data(payload)
                _store_cpor_upload(file_name, file_bytes)
                
                return {
                    "success": True,
                    "message": "Dados combinados e atualizados com sucesso.",
                    "metadata": payload.get("metadata", {}),
                    "rowsImported": len(payload.get("raw_data_for_filters", []))
                }
            except Exception as e:
                return {"success": False, "message": str(e)}

        # Emendas operations removed as requested not to include Emendas
        return {}

    def _parse_trpc_input(raw_body: Optional[str], raw_query: Optional[str]) -> Dict[str, object]:
        payload: Dict[str, object] = {}
        raw_value = raw_query or raw_body
        if not raw_value: return payload
        try:
            parsed = json.loads(raw_value)
        except json.JSONDecodeError: return payload
        if isinstance(parsed, dict): return parsed
        if isinstance(parsed, list): return {str(idx): item for idx, item in enumerate(parsed)}
        return payload

    def _parse_trpc_body():
        try: return request.get_json(silent=True)
        except Exception: return None

    @portal.route("/api/trpc", defaults={"paths": ""}, methods=["GET", "POST"])
    @portal.route("/api/trpc/<path:paths>", methods=["GET", "POST"])
    def trpc_handler(paths: str):
        path_segments = [segment.strip() for segment in (paths or "").split(",") if segment.strip()]
        if not path_segments:
            return jsonify({"error": "No TRPC operation."}), 400
        
        payload_map = _parse_trpc_input(
            request.get_data(as_text=True) if request.method == "POST" else None,
            request.args.get("input"),
        )
        # Simplify body parsing for batch
        # (Assuming simple structure for now based on previous code)
        dataset = load_dashboard_data()
        responses = []
        
        # Helper to get input for an index
        def get_input_for(idx):
             if payload_map:
                 return payload_map.get(str(idx), {}).get("json")
             return None

        # Basic batch handling
        for idx, path in enumerate(path_segments):
             # For simplicity in this replicate, we just resolve. 
             # Full batch logic from original is complex, simplifying for speed.
             try:
                 input_data = get_input_for(idx)
                 result = _resolve_trpc_operation(path, dataset, input_data)
                 responses.append({
                     "jsonrpc": "2.0",
                     "result": {"data": {"json": result}},
                     "id": idx
                 })
             except Exception as e:
                 responses.append({
                     "jsonrpc": "2.0",
                     "error": {"code": -32603, "message": str(e)},
                     "id": idx
                 })
        return jsonify(responses)

    @portal.route("/api/dashboard/upload", methods=["POST"])
    def dashboard_upload():
        file = request.files.get("file")
        if not file or not file.filename:
            return jsonify({"success": False, "message": "No file selected"}), 400
        try:
            summary = _ingest_dashboard_spreadsheet(file.read(), file.filename)
            return jsonify({"success": True, "summary": summary})
        except Exception as e:
            return jsonify({"success": False, "message": str(e)}), 400

    @portal.route("/healthz")
    def healthcheck():
        return {"status": "ok"}

    return portal


def create_application() -> DispatcherMiddleware:
    saiku_app = _load_apps()
    portal_app = _create_portal_app()
    
    mounts = {}
    if saiku_app:
        mounts["/saiku"] = saiku_app

    return DispatcherMiddleware(portal_app, mounts)

application = create_application()

def main():
    # Using 8050 as requested to replicate, but if 8050 is busy we might need to kill it first in the terminal.
    port = int(os.getenv("PORT", "8050"))
    run_simple(
        "0.0.0.0",
        port,
        application,
        use_reloader=True,
        use_debugger=False,
        threaded=True,
    )

if __name__ == "__main__":
    main()
