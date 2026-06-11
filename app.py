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
import time
import threading
from flask import Flask, abort, jsonify, render_template, request, send_from_directory, send_file
from werkzeug.middleware.dispatcher import DispatcherMiddleware
from werkzeug.serving import run_simple
from werkzeug.utils import secure_filename

# Import CPOR processing logic
from cpor_data_processing import (
    load_dashboard_data,
    process_dashboard_upload,
    save_dashboard_data,
)
from data_manager import ingest_dashboard_spreadsheet, store_cpor_upload

BASE_DIR = Path(__file__).resolve().parent
# CPOR Static files copied to static/cpor/public
UNB_PUBLIC_DIR = BASE_DIR / "static" / "cpor" / "public"
CI_PUBLIC_DIR = BASE_DIR / "static" / "ci" / "public"
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
        {
            "slug": "cpor",
            "title": "Dashboard Custos Indiretos",
            "description": "Análise de Custos Indiretos",
            "href": "/custos-indiretos/#/dashboard",
            "accent": "#3b82f6",
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

# Funções movidas para data_manager.py


def _create_portal_app() -> Flask:
    template_dir = BASE_DIR / "templates"
    portal = Flask(__name__, static_folder=None, template_folder=str(template_dir))
    
    # Registrar blueprint de versões
    from versions_routes import versions_bp
    portal.register_blueprint(versions_bp)

    @portal.route("/")
    def index():
        return render_template("index.html", entries=_portal_entries())
    
    # Health check endpoint for keep-alive
    @portal.route("/health")
    def health_check():
        return jsonify({
            "status": "healthy",
            "timestamp": datetime.utcnow().isoformat(),
            "service": "DPO Dashboard UnB"
        }), 200

    # --- Serving React App (CPOR) ---
    @portal.route("/dashboard/")
    def serve_dashboard_index():
        if not UNB_PUBLIC_DIR.exists():
             return "Dashboard build not found. Please run build.", 404
        return send_from_directory(UNB_PUBLIC_DIR, "index.html")

    # --- Serving React App (Custos Indiretos) ---
    @portal.route("/custos-indiretos/")
    def serve_ci_index():
        if not CI_PUBLIC_DIR.exists():
             return "CI Dashboard build not found. Please run build.", 404
        return send_from_directory(CI_PUBLIC_DIR, "index.html")

    @portal.route("/custos-indiretos/<path:asset_path>")
    def serve_ci_assets(asset_path: str):
        target = CI_PUBLIC_DIR / asset_path
        if target.exists() and target.is_file():
            return send_from_directory(CI_PUBLIC_DIR, asset_path)
        return send_from_directory(CI_PUBLIC_DIR, "index.html")

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

    # --- API Upload Endpoint (Opção 1) ---
    @portal.route("/api/upload-data", methods=["POST"])
    def api_upload_data():
        """
        Endpoint para upload direto de planilha via API.
        Autenticação: Bearer <TOKEN>
        """
        token = request.headers.get("Authorization")
        expected_token = os.environ.get("API_UPLOAD_TOKEN", "default-dev-token")
        
        # Remove 'Bearer ' prefix
        if token and token.startswith("Bearer "):
            token = token.split(" ", 1)[1]
            
        # Validação simples de token
        if token != expected_token:
            if not os.environ.get("API_UPLOAD_TOKEN"):
                return jsonify({"error": "API Token not configured"}), 500
            time.sleep(1) # Delay para evitar brute-force rápido
            return jsonify({"error": "Unauthorized"}), 401
            
        if "file" not in request.files:
            return jsonify({"error": "No file part"}), 400
            
        file = request.files["file"]
        if file.filename == "":
            return jsonify({"error": "No selected file"}), 400
            
        if not file.filename.lower().endswith((".xlsx", ".xls")):
            return jsonify({"error": "Invalid file type. Only Excel (.xlsx, .xls) allowed"}), 400
            
        try:
            file_bytes = file.read()
            filename = secure_filename(file.filename)
            
            # Processa usando a lógica centralizada
            result = ingest_dashboard_spreadsheet(file_bytes, filename)
            
            return jsonify({
                "status": "success",
                "message": "Dashboard updated successfully",
                "filename": filename,
                "timestamp": datetime.utcnow().isoformat(),
                "details": result
            })
            
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @portal.route("/api/webhook/make", methods=["POST"])
    def api_webhook_make():
        """
        Webhook para Make.com enviar a planilha automaticamente.
        """
        token = request.args.get("token") or request.headers.get("Authorization")
        expected_token = os.environ.get("WEBHOOK_TOKEN", "alexandre-unb-2026")
        
        # Verify Token
        if token != expected_token and token != f"Bearer {expected_token}":
            return jsonify({"error": "Unauthorized"}), 401
            
        if "file" not in request.files:
            return jsonify({"error": "No file part"}), 400
            
        file = request.files["file"]
        if file.filename == "":
            return jsonify({"error": "No selected file"}), 400
            
        if not file.filename.lower().endswith((".xlsx", ".xls", ".csv", ".html")):
            return jsonify({"error": "Invalid file type"}), 400
            
        sender_email = request.form.get("sender_email", "Sistema Automático (Make.com)")
            
        try:
            file_bytes = file.read()
            filename = secure_filename(file.filename)
            
            result = ingest_dashboard_spreadsheet(file_bytes, filename, sender_email=sender_email)
            
            return jsonify({
                "status": "success",
                "message": "Dashboard updated successfully via Webhook",
                "filename": filename,
                "timestamp": datetime.utcnow().isoformat(),
                "details": result
            })
            
        except Exception as e:
            return jsonify({"error": str(e)}), 500




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
                result = ingest_dashboard_spreadsheet(file_bytes, file_name)
                
                # Reload to get updated metadata if needed
                updated_dataset = load_dashboard_data()
                
                return {
                    "success": True,
                    "message": "Dados combinados e atualizados com sucesso.",
                    "metadata": updated_dataset.get("metadata", {}),
                    "rowsImported": result.get("linhas_processadas", 0)
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

    @portal.route("/api/dashboard/download-latest", methods=["GET"])
    def download_latest_cpor():
        """Baixa a planilha de dados mais recente enviada."""
        upload_dir = BASE_DIR / "uploads" / "cpor"
        if not upload_dir.exists():
            return jsonify({"error": "Nenhum arquivo encontrado."}), 404
            
        files = [f for f in upload_dir.glob("*.xlsx") if f.is_file()]
        if not files:
            files = [f for f in upload_dir.glob("*.xls") if f.is_file()]
            
        if not files:
            return jsonify({"error": "Nenhuma planilha encontrada."}), 404
            
        latest_file = max(files, key=lambda f: f.stat().st_mtime)
        
        return send_file(
            latest_file,
            as_attachment=True,
            download_name=latest_file.name
        )

    @portal.route("/healthz")
    def healthcheck():
        return {"status": "ok"}

    @portal.after_request
    def add_header(response):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

    return portal


def create_application() -> DispatcherMiddleware:
    saiku_app = _load_apps()
    portal_app = _create_portal_app()
    
    mounts = {}
    if saiku_app:
        mounts["/saiku"] = saiku_app

    return DispatcherMiddleware(portal_app, mounts)

application = create_application()

# --- Email Monitor Background Thread ---
def start_email_monitor():
    """Inicia o monitoramento de email em uma thread separada se configurado."""
    email_user = os.environ.get("EMAIL_USER")
    email_pass = os.environ.get("EMAIL_PASSWORD")
    
    if not email_user or not email_pass:
        print("Email monitor not started: EMAIL_USER or EMAIL_PASSWORD not set.")
        return

    try:
        import threading
        from mail_monitor import run_email_monitor
        
        monitor_thread = threading.Thread(target=run_email_monitor, daemon=True)
        monitor_thread.start()
        print(f"Email monitor started for {email_user}")
    except Exception as e:
        print(f"Failed to start email monitor: {e}")

# --- Inicialização dos serviços de background ---
# IMPORTANTE: estas chamadas ficam no nível do módulo para que o Gunicorn
# (que nunca chama main()) também as execute ao importar app:application
def _start_background_services():
    """Inicia serviços de background (keep-alive e monitor de email).

    NOTA: Boot recovery foi removido. O auto-commit no GitHub garante que
    dashboard_data.json sempre esteja atualizado após qualquer restart.
    Reprocessar no boot atualizava updated_at desnecessariamente e
    disparava novos auto-commits, criando um loop de atualizações.
    """
    # Keep-alive: evita que o Render free-tier durma
    try:
        from keep_alive import start_keep_alive
        start_keep_alive()
    except Exception as e:
        print(f"⚠️ Keep-alive não iniciado: {e}")

    # Monitor de email desativado para evitar bloqueios do provedor (substituído por Webhook via Make.com)
    # start_email_monitor()

# Executar apenas uma vez por processo (evita duplicação com múltiplos workers)
if os.environ.get("_EMAIL_MONITOR_STARTED") != "1":
    os.environ["_EMAIL_MONITOR_STARTED"] = "1"
    _start_background_services()


def main():
    # Os serviços de background já foram iniciados no nível do módulo.
    # main() só é chamada quando rodando localmente com `python app.py`.
    port = int(os.getenv("PORT", "8050"))
    run_simple(
        "0.0.0.0",
        port,
        application,
        use_reloader=False,  # reloader=True conflita com threads daemon
        use_debugger=False,
        threaded=True,
    )

if __name__ == "__main__":
    main()
