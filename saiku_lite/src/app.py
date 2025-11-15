"""Saiku Lite Flask application."""
from __future__ import annotations

import copy
import io
import json
import os
import shutil
import uuid
from functools import wraps
from pathlib import Path
from typing import Any, Dict, List, Optional
import subprocess
import time

import pandas as pd
from fpdf import FPDF
from flask import (
    Flask,
    Response,
    abort,
    flash,
    has_request_context,
    jsonify,
    redirect,
    render_template,
    request,
    send_file,
    send_from_directory,
    session,
    url_for,
)
import requests
from urllib.parse import urljoin
from werkzeug.security import check_password_hash
from werkzeug.utils import secure_filename

from .data_loader import DataLoaderError, load_dataframe
from .pivot import (
    CalculationError,
    PivotError,
    apply_post_calculations,
    apply_pre_calculations,
    available_aggregations,
    build_pivot,
    pivot_result_to_dataframe,
)
from .dashboard import (
    DashboardError,
    DashboardManager,
    LIMITE_DIAS_VENCIMENTO,
    PCT_EXEC_ALTA,
    PCT_SALDO_BAIXO,
    build_unb_dashboard_payload,
)

from .users import UserStore

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SAIKU_SECRET_KEY", "change-me")
app.config["TEMPLATES_AUTO_RELOAD"] = True

ADMIN_USERNAME = os.environ.get("SAIKU_ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("SAIKU_ADMIN_PASSWORD", "senha123")

os.makedirs(app.instance_path, exist_ok=True)
USER_DB_PATH = os.environ.get("SAIKU_USER_DB", str(Path(app.instance_path) / "users.db"))
user_store = UserStore(USER_DB_PATH)
user_store.ensure_admin(ADMIN_USERNAME, ADMIN_PASSWORD)

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_UNB_DASHBOARD_PUBLIC = BASE_DIR / "unb-budget-dashboard" / "dist" / "public"
UNB_DASHBOARD_PUBLIC = Path(
    os.environ.get("UNB_DASHBOARD_PUBLIC", str(DEFAULT_UNB_DASHBOARD_PUBLIC))
).expanduser()
DEFAULT_UNB_DASHBOARD_DATA = BASE_DIR / "unb-budget-dashboard" / "dashboard_data.json"
UNB_DASHBOARD_DATA = Path(os.environ.get("UNB_DASHBOARD_DATA", str(DEFAULT_UNB_DASHBOARD_DATA))).expanduser()
def _normalize_base_path(raw: Optional[str]) -> str:
    if not raw:
        return ""
    cleaned = raw.strip()
    if not cleaned:
        return ""
    if not cleaned.startswith("/"):
        cleaned = f"/{cleaned.lstrip('/')}"
    cleaned = cleaned.rstrip("/")
    if cleaned == "/":
        return ""
    return cleaned


PORTAL_HOME_URL = os.environ.get("PORTAL_HOME_URL", "/")
SAIKU_BASE_PATH = _normalize_base_path(os.environ.get("SAIKU_BASE_PATH"))
AUTH_DISABLED = os.environ.get("SAIKU_DISABLE_AUTH", "1").strip().lower() in {"1", "true", "yes", "on"}
if SAIKU_BASE_PATH:
    app.config["APPLICATION_ROOT"] = SAIKU_BASE_PATH


def _sync_session_from_user(user: Dict[str, Any], *, ignore_force_change: bool = False) -> None:
    session["user_id"] = user["id"]
    session["user_authenticated"] = True
    session["username"] = user["username"]
    session["is_admin"] = bool(user["is_admin"])
    session["can_access_reports"] = _user_can_access_reports(user)
    session["can_access_dashboard"] = _user_can_access_dashboard(user)
    session["force_password_change"] = False if ignore_force_change else bool(user["must_change_password"])


def _load_admin_user() -> Dict[str, Any]:
    admin = user_store.get_by_username(ADMIN_USERNAME)
    if not admin:
        admin = user_store.ensure_admin(ADMIN_USERNAME, ADMIN_PASSWORD)
    return admin


def _current_base_path() -> str:
    script_root = ""
    if has_request_context():
        script_root = _normalize_base_path(request.script_root)
        if not script_root:
            script_root = _normalize_base_path(request.environ.get("SCRIPT_NAME"))
    return script_root or SAIKU_BASE_PATH or ""


@app.context_processor
def inject_base_path() -> Dict[str, str]:
    return {"saiku_base_path": _current_base_path()}


def _get_current_user() -> Optional[Dict[str, Any]]:
    if AUTH_DISABLED:
        user_id = session.get("user_id")
        user = user_store.get_by_id(int(user_id)) if user_id else None
        if not user:
            user = _load_admin_user()
        _sync_session_from_user(user, ignore_force_change=True)
        return user
    user_id = session.get("user_id")
    if not user_id:
        return None
    user = user_store.get_by_id(int(user_id))
    if not user:
        session.clear()
        return None
    _sync_session_from_user(user)
    return user


def _public_user(user: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not user:
        return None
    data = dict(user)
    data.pop("password_hash", None)
    data.pop("normalized_username", None)
    return data


def _is_authenticated() -> bool:
    return _get_current_user() is not None


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = _get_current_user()
        if user:
            if session.get("force_password_change") and request.endpoint not in {
                "change_password",
                "logout",
                "static",
            }:
                if request.path.startswith("/api/"):
                    response = jsonify({"error": "Senha precisa ser atualizada."})
                    response.status_code = 403
                    response.headers["X-Force-Password-Change"] = "1"
                    return response
                return redirect(url_for("change_password", next=_requested_path()))
            return view(*args, **kwargs)
        login_url = url_for("login", next=_requested_path())
        if request.path.startswith("/api/"):
            return jsonify({"error": "Não autenticado."}), 401
        return redirect(login_url)

    return wrapped


def admin_required(view):
    @login_required
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = _get_current_user()
        if user and user["is_admin"]:
            return view(*args, **kwargs)
        if request.path.startswith("/api/"):
            return jsonify({"error": "Acesso restrito."}), 403
        abort(403)

    return wrapped


def _user_can_access_reports(user: Optional[Dict[str, Any]]) -> bool:
    if AUTH_DISABLED:
        return True
    if not user:
        return False
    return bool(user.get("can_access_reports") or user.get("is_admin"))


def _user_can_access_dashboard(user: Optional[Dict[str, Any]]) -> bool:
    if AUTH_DISABLED:
        return True
    if not user:
        return False
    return bool(user.get("can_access_dashboard") or user.get("is_admin"))


def reports_access_required(view):
    @login_required
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = _get_current_user()
        if _user_can_access_reports(user):
            return view(*args, **kwargs)
        if request.path.startswith("/api/"):
            return jsonify({"error": "Acesso restrito aos relatórios."}), 403
        if user and _user_can_access_dashboard(user):
            flash("Seu usuário não tem acesso aos relatórios.", "warning")
            return redirect(url_for("dashboard_page"))
        abort(403)

    return wrapped


def dashboard_access_required(view):
    @login_required
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = _get_current_user()
        if _user_can_access_dashboard(user):
            return view(*args, **kwargs)
        if request.path.startswith("/api/"):
            return jsonify({"error": "Acesso restrito ao dashboard."}), 403
        if user and _user_can_access_reports(user):
            flash("Seu usuário não tem acesso ao dashboard.", "warning")
            return redirect(url_for("index"))
        abort(403)

    return wrapped


def _requested_path() -> str:
    raw_path = request.full_path.rstrip("?") if request.query_string else request.path
    script_root = request.script_root or ""
    if script_root and script_root != "/":
        combined = f"{script_root.rstrip('/')}{raw_path}"
    elif script_root == "/" and not raw_path.startswith("/"):
        combined = f"/{raw_path}"
    else:
        combined = raw_path
    if not combined.startswith("/"):
        combined = f"/{combined}"
    return combined


def _resolve_next_target(candidate: str | None) -> str:
    default_target = url_for("index")
    if not candidate:
        return default_target
    candidate = candidate.strip()
    if candidate == "/":
        return default_target
    if not candidate.startswith("/"):
        return default_target
    if candidate.startswith("//"):
        return default_target
    if candidate.startswith("/api/"):
        return default_target
    return candidate


@app.route("/login", methods=["GET", "POST"])
def login():
    next_url = _resolve_next_target(request.values.get("next"))
    if AUTH_DISABLED:
        _get_current_user()
        return redirect(next_url)
    if _is_authenticated() and request.method == "GET":
        if session.get("force_password_change"):
            return redirect(url_for("change_password", next=next_url))
        return redirect(next_url)

    error = None
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        user = user_store.authenticate(username, password)
        if user:
            session.clear()
            session["user_authenticated"] = True
            session["user_id"] = user["id"]
            session["username"] = user["username"]
            session["is_admin"] = bool(user["is_admin"])
            session["can_access_reports"] = _user_can_access_reports(user)
            session["can_access_dashboard"] = _user_can_access_dashboard(user)
            session["force_password_change"] = bool(user["must_change_password"])
            target = url_for("change_password", next=next_url) if session.get("force_password_change") else next_url
            return redirect(target)
        error = "Usuário ou senha inválidos."

    return render_template("login.html", error=error, next_url=next_url)


# Development helper: when SAIKU_ALLOW_DEV_LOGIN is set to '1', allow creating
# an admin session without password for local testing. This endpoint is disabled
# by default and should NOT be enabled in production.
@app.get("/__dev_login")
def _dev_login():
    if os.environ.get("SAIKU_ALLOW_DEV_LOGIN") != "1":
        return jsonify({"error": "dev login disabled"}), 403
    # create or ensure admin user exists, then set session
    admin = user_store.get_by_username(ADMIN_USERNAME)
    if not admin:
        # create admin with default password if missing
        try:
            user_store.create_user(ADMIN_USERNAME, ADMIN_PASSWORD, is_admin=True, must_change_password=False)
            admin = user_store.get_by_username(ADMIN_USERNAME)
        except Exception:
            pass
    if not admin:
        return jsonify({"error": "admin user not available"}), 500
    # ensure the admin user record does not require a password change (useful for dev)
    try:
        if admin.get("must_change_password"):
            # update the stored password to the configured admin password and clear the flag
            user_store.update_password(admin["id"], ADMIN_PASSWORD, must_change_password=False)
            admin = user_store.get_by_username(ADMIN_USERNAME)
    except Exception:
        # best-effort only; if update fails proceed to create session anyway
        app.logger.exception("Failed to clear must_change_password for admin in dev login")

    session.clear()
    session["user_authenticated"] = True
    session["user_id"] = admin["id"]
    session["username"] = admin["username"]
    session["is_admin"] = True
    session["can_access_reports"] = True
    session["can_access_dashboard"] = True
    session["force_password_change"] = False
    return jsonify({"ok": True, "username": session.get("username")})


@app.get("/logout")
@login_required
def logout():
    session.clear()
    target = PORTAL_HOME_URL or url_for("login")
    return redirect(target)


@app.route("/change-password", methods=["GET", "POST"])
@login_required
def change_password():
    user = _get_current_user()
    if user is None:
        return redirect(url_for("login"))

    require_current = not session.get("force_password_change")
    error = None
    next_url = _resolve_next_target(request.values.get("next"))

    if request.method == "POST":
        current_password = request.form.get("current_password") or ""
        new_password = request.form.get("new_password") or ""
        confirm_password = request.form.get("confirm_password") or ""

        if require_current and not user_store.authenticate(user["username"], current_password):
            error = "Senha atual incorreta."
        elif len(new_password) < 6:
            error = "A nova senha deve ter pelo menos 6 caracteres."
        elif new_password != confirm_password:
            error = "As senhas não conferem."
        elif check_password_hash(user["password_hash"], new_password):
            error = "A nova senha deve ser diferente da senha atual."
        else:
            user_store.update_password(user["id"], new_password, must_change_password=False)
            session["force_password_change"] = False
            flash("Senha atualizada com sucesso.", "success")
            return redirect(next_url)

    return render_template(
        "change_password.html",
        error=error,
        require_current=require_current,
        next_url=next_url,
    )


class DatasetRegistry:
    """In-memory storage for uploaded datasets."""

    def __init__(self) -> None:
        self._datasets: Dict[str, Dict[str, Any]] = {}

    def create(self, filename: str, dataframe: pd.DataFrame) -> Dict[str, Any]:
        dataset_id = str(uuid.uuid4())
        numeric_columns = dataframe.select_dtypes(include=["number", "bool"]).columns.tolist()
        dimension_columns = [col for col in dataframe.columns.tolist() if col not in numeric_columns]
        info: Dict[str, Any] = {
            "id": dataset_id,
            "name": filename,
            "frame": dataframe,
            "columns": dataframe.columns.tolist(),
            "dimensions": dimension_columns,
            "measures": numeric_columns or dataframe.columns.tolist(),
            "row_count": int(dataframe.shape[0]),
            "schema": {col: str(dtype) for col, dtype in dataframe.dtypes.items()},
        }
        self._datasets[dataset_id] = info
        return info

    def get(self, dataset_id: str) -> Dict[str, Any]:
        if dataset_id not in self._datasets:
            raise KeyError(dataset_id)
        return self._datasets[dataset_id]

    def ids(self) -> List[str]:
        return list(self._datasets.keys())

    def delete(self, dataset_id: str) -> None:
        self._datasets.pop(dataset_id, None)


datasets = DatasetRegistry()
dashboard_manager = DashboardManager()


def _dashboard_config() -> Dict[str, Any]:
    return {
        "limitDiasVencimento": LIMITE_DIAS_VENCIMENTO,
        "pctSaldoBaixo": PCT_SALDO_BAIXO,
        "pctExecucaoAlta": PCT_EXEC_ALTA,
    }


def _normalize_filters(raw_filters: Dict[str, Any]) -> Dict[str, List[str]]:
    normalized: Dict[str, List[str]] = {}
    for column, values in (raw_filters or {}).items():
        if not isinstance(values, list):
            continue
        keep = [str(value) for value in values if value is not None]
        if keep:
            normalized[column] = keep
    return normalized


def _apply_filters(frame: pd.DataFrame, filters: Dict[str, List[str]]) -> pd.DataFrame:
    if not filters:
        return frame
    subset = frame
    for column, values in filters.items():
        if column not in subset.columns or not values:
            continue
        mask = subset[column].astype(str).isin(values)
        subset = subset[mask]
    return subset


def _normalize_calculations(value: Any, field: str) -> List[Dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{field!r} deve ser uma lista de objetos com a definição dos cálculos.")
    normalized: List[Dict[str, Any]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise ValueError(f"{field!r}[{index}] deve ser um objeto com a definição do cálculo.")
        normalized.append(item)
    return normalized


def _normalize_measures(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        measures = [str(item) for item in value if item]
    else:
        measures = [str(value)]
    # remove duplicates preserving order
    seen: Dict[str, None] = {}
    for measure in measures:
        if measure not in seen:
            seen[measure] = None
    return list(seen.keys())


@app.get("/")
@reports_access_required
def index():
    user = _get_current_user()
    return render_template(
        "index.html",
        username=session.get("username"),
        is_admin=bool(user["is_admin"]) if user else False,
        active_tab="reports",
        can_access_reports=_user_can_access_reports(user),
        can_access_dashboard=_user_can_access_dashboard(user),
    )


def _unb_dashboard_available() -> bool:
    index_path = UNB_DASHBOARD_PUBLIC / "index.html"
    assets_dir = UNB_DASHBOARD_PUBLIC / "assets"
    return index_path.exists() and assets_dir.exists()


def _serve_unb_dashboard_index():
    index_path = UNB_DASHBOARD_PUBLIC / "index.html"
    response = send_file(index_path)
    response.cache_control.no_cache = True
    return response


def _render_dashboard_fallback():
    user = _get_current_user()
    datasets_list = dashboard_manager.datasets()
    initial_dataset_id = datasets_list[0]["id"] if datasets_list else None
    return render_template(
        "dashboard.html",
        username=session.get("username"),
        is_admin=bool(user["is_admin"]) if user else False,
        active_tab="dashboard",
        can_access_reports=_user_can_access_reports(user),
        can_access_dashboard=_user_can_access_dashboard(user),
        datasets=datasets_list,
        initial_dataset_id=initial_dataset_id,
        config=_dashboard_config(),
    )


def _serve_dashboard_entry():
    _start_node_server()
    if _unb_dashboard_available():
        return _serve_unb_dashboard_index()

    dashboard_dir = os.path.join(app.static_folder, "dashboard")
    index_path = os.path.join(dashboard_dir, "index.html")
    spa_available = os.path.exists(index_path) and _dashboard_backend_available()

    if spa_available:
        response = send_from_directory(dashboard_dir, "index.html")
        response.cache_control.no_cache = True
        return response

    return _render_dashboard_fallback()


def _persist_unb_dashboard_dataset(dataset):
    try:
        payload = build_unb_dashboard_payload(dataset)
    except Exception:
        app.logger.exception("Erro ao montar payload para o dashboard UnB")
        raise
    try:
        UNB_DASHBOARD_DATA.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = UNB_DASHBOARD_DATA.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp_path.replace(UNB_DASHBOARD_DATA)
        app.logger.info("Arquivo dashboard_data.json atualizado com sucesso em %s", UNB_DASHBOARD_DATA)
    except Exception:
        app.logger.exception("Erro ao salvar dashboard_data.json")
        raise
    _notify_unb_backend_refresh()


def _notify_unb_backend_refresh():
    if not _dashboard_backend_available():
        return
    _restart_node_server()


def _restart_node_server():
    global NODE_SERVER_PROCESS
    if NODE_SERVER_PROCESS is None:
        return
    if NODE_SERVER_PROCESS.poll() is not None:
        NODE_SERVER_PROCESS = None
        return
    try:
        NODE_SERVER_PROCESS.terminate()
        NODE_SERVER_PROCESS.wait(timeout=5)
    except subprocess.TimeoutExpired:
        NODE_SERVER_PROCESS.kill()
    except Exception:
        app.logger.exception("Erro ao reiniciar backend Node")
    finally:
        NODE_SERVER_PROCESS = None


@app.get("/dashboard")
@dashboard_access_required
def dashboard_page():
    return _serve_dashboard_entry()


@app.get("/dashboard/fallback")
@dashboard_access_required
def dashboard_fallback_page():
    return _render_dashboard_fallback()


@app.get("/dashboard/assets/<path:filename>")
@dashboard_access_required
def dashboard_assets(filename: str):
    candidate_dirs: List[Path] = []
    unb_assets = UNB_DASHBOARD_PUBLIC / "assets"
    if unb_assets.exists():
        candidate_dirs.append(unb_assets)
    default_assets = Path(app.static_folder) / "dashboard" / "assets"
    candidate_dirs.append(default_assets)

    for directory in candidate_dirs:
        path = directory / filename
        if path.exists():
            response = send_from_directory(str(directory), filename)
            response.cache_control.no_cache = True
            return response

    abort(404)


@app.get("/dashboard/<path:subpath>")
@dashboard_access_required
def dashboard_catch_all(subpath: str):
    if subpath.startswith("assets/"):
        filename = subpath[len("assets/") :]
        return dashboard_assets(filename)
    if subpath == "fallback":
        return dashboard_fallback_page()
    return _serve_dashboard_entry()


DASHBOARD_CLIENT_ROUTES = [
    "alerts",
    "charts/distribution",
    "charts/execution",
    "charts/monthly",
    "comparisons",
    "comparisons-ugr",
    "data-upload",
    "kpis",
    "predictive-analysis",
    "trends",
    "ugr-details",
    "404",
]

for _route in DASHBOARD_CLIENT_ROUTES:
    endpoint_name = f"dashboard_client_{_route.replace('/', '_')}"
    app.add_url_rule(f"/{_route}", endpoint_name, dashboard_page)


# Proxy /api/trpc requests to o backend moderno do dashboard. Por padrão apontamos
# para http://127.0.0.1:3000, mas pode ser alterado via DASHBOARD_API_URL.
DEFAULT_DASHBOARD_API = "http://127.0.0.1:3000"
API_BACKEND = os.environ.get("DASHBOARD_API_URL", DEFAULT_DASHBOARD_API)

# Variáveis para gerenciar o processo Node.js
NODE_SERVER_PROCESS = None
_DEFAULT_NODE_DIRS = [
    BASE_DIR / "unb-budget-dashboard",
    Path("/home/ubuntu/unb-budget-dashboard2/unb-budget-dashboard"),
]


def _resolve_node_dir() -> Path:
    """Escolhe o diretório do dashboard para subir o backend Node."""
    env_dir = os.environ.get("DASHBOARD_NODE_DIR")
    if env_dir:
        return Path(env_dir).expanduser()
    for candidate in _DEFAULT_NODE_DIRS:
        if candidate.exists():
            return candidate
    # Retorna o primeiro candidato para manter compatibilidade antiga
    return _DEFAULT_NODE_DIRS[0]


NODE_SERVER_DIR = _resolve_node_dir()
NODE_WARNING_EMITTED = False


def _using_local_dashboard_backend() -> bool:
    """Retorna True quando devemos subir o backend Node localmente."""
    return API_BACKEND == DEFAULT_DASHBOARD_API


def _node_environment_ready() -> bool:
    """Confere se temos Node.js instalado e diretório configurado."""
    return shutil.which("node") is not None and NODE_SERVER_DIR.exists()


def _dashboard_backend_available() -> bool:
    """Indica se existe backend configurado para alimentar o SPA."""
    if not _using_local_dashboard_backend():
        return True
    return _node_environment_ready()


def _start_node_server():
    global NODE_SERVER_PROCESS, NODE_WARNING_EMITTED
    if not _using_local_dashboard_backend():
        return
    if not _node_environment_ready():
        if not NODE_WARNING_EMITTED:
            NODE_WARNING_EMITTED = True
            app.logger.warning(
                "Dashboard backend (Node.js) não pôde ser iniciado automaticamente. "
                "Instale o Node e configure DASHBOARD_NODE_DIR para habilitar o recurso."
            )
        return
    if NODE_SERVER_PROCESS is not None and NODE_SERVER_PROCESS.poll() is None:
        return

    # Verifica se o servidor já está rodando
    try:
        requests.get(API_BACKEND, timeout=1)
        return
    except requests.exceptions.RequestException:
        pass

    # Inicia o servidor Node.js
    command = ["node", "dist/index.js"]
    try:
        NODE_SERVER_PROCESS = subprocess.Popen(
            command,
            cwd=NODE_SERVER_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        # Espera um pouco para o servidor iniciar
        time.sleep(2)
    except FileNotFoundError:
        app.logger.error("Comando 'node' não encontrado. Certifique-se de que o Node.js está instalado.")
    except Exception:
        app.logger.exception("Erro ao iniciar o servidor Node.js")

@app.before_request
def start_node_server_if_needed():
    if request.path.startswith("/dashboard") or request.path.startswith("/api/trpc"):
        _start_node_server()

@app.teardown_appcontext
def shutdown_node_server(exception=None):
    global NODE_SERVER_PROCESS
    if NODE_SERVER_PROCESS is not None:
        # Tenta encerrar o processo de forma limpa
        NODE_SERVER_PROCESS.terminate()
        try:
            NODE_SERVER_PROCESS.wait(timeout=5)
        except subprocess.TimeoutExpired:
            # Se não encerrar, mata o processo
            NODE_SERVER_PROCESS.kill()
        NODE_SERVER_PROCESS = None


def _proxy_request_to_backend(path: str):
    # Build target URL
    target = urljoin(API_BACKEND.rstrip('/') + '/', path.lstrip('/'))
    # Forward headers (except Host)
    headers = {k: v for k, v in request.headers if k.lower() != 'host'}
    try:
        resp = requests.request(
            method=request.method,
            url=target,
            headers=headers,
            params=request.args,
            data=request.get_data(),
            cookies=request.cookies,
            allow_redirects=False,
            timeout=10,
        )
    except requests.RequestException as exc:
        app.logger.exception("Erro ao proxyar requisição para backend %s", target)
        return jsonify({"error": "Erro ao contatar backend de dados."}), 502

    excluded_headers = [
        'content-encoding',
        'content-length',
        'transfer-encoding',
        'connection',
    ]
    headers = [(name, value) for (name, value) in resp.headers.items() if name.lower() not in excluded_headers]
    return Response(resp.content, resp.status_code, headers)


@app.route('/api/trpc', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
@dashboard_access_required
def proxy_trpc_root():
    return _proxy_request_to_backend('/api/trpc')


@app.route('/api/trpc/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
@dashboard_access_required
def proxy_trpc(path: str):
    return _proxy_request_to_backend(f'/api/trpc/{path}')


@app.get("/assets/<path:filename>")
@dashboard_access_required
def legacy_dashboard_assets(filename: str):
    assets_dir = os.path.join(app.static_folder, "dashboard", "assets")
    path = os.path.join(assets_dir, filename)
    if not os.path.exists(path):
        abort(404)
    response = send_from_directory(assets_dir, filename)
    response.cache_control.no_cache = True
    return response


@app.route("/admin/users", methods=["GET", "POST"])
@admin_required
def manage_users():
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        is_admin = request.form.get("is_admin") == "1"
        can_access_reports = request.form.get("can_access_reports") == "1"
        can_access_dashboard = request.form.get("can_access_dashboard") == "1"
        if not is_admin and not (can_access_reports or can_access_dashboard):
            flash("Selecione ao menos um acesso (Relatórios ou Dashboard).", "error")
            return redirect(url_for("manage_users"))
        try:
            user_store.create_user(
                username,
                password,
                is_admin=is_admin,
                must_change_password=True,
                can_access_reports=can_access_reports,
                can_access_dashboard=can_access_dashboard,
            )
            flash("Usuário criado com sucesso.", "success")
        except ValueError as exc:
            flash(str(exc), "error")
        return redirect(url_for("manage_users"))

    users = [_public_user(user) for user in user_store.list_users()]
    current_user = _public_user(_get_current_user())
    return render_template("admin_users.html", users=users, current_user=current_user)


@app.post("/admin/users/<int:user_id>/delete")
@admin_required
def delete_user(user_id: int):
    if session.get("user_id") == user_id:
        flash("Você não pode remover o seu próprio usuário.", "error")
        return redirect(url_for("manage_users"))
    try:
        user_store.delete_user(user_id)
        flash("Usuário removido.", "success")
    except ValueError as exc:
        flash(str(exc), "error")
    return redirect(url_for("manage_users"))


@app.post("/admin/users/<int:user_id>/reset-password")
@admin_required
def reset_user_password(user_id: int):
    new_password = request.form.get("new_password") or ""
    confirm_password = request.form.get("confirm_password") or ""
    if new_password != confirm_password:
        flash("As senhas informadas não conferem.", "error")
        return redirect(url_for("manage_users"))
    try:
        user_store.update_password(user_id, new_password, must_change_password=True)
        flash("Senha redefinida. O usuário deverá alterá-la no próximo acesso.", "success")
    except ValueError as exc:
        flash(str(exc), "error")
    return redirect(url_for("manage_users"))


@app.post("/admin/users/<int:user_id>/permissions")
@admin_required
def update_user_permissions(user_id: int):
    user = user_store.get_by_id(user_id)
    if user is None:
        flash("Usuário não encontrado.", "error")
        return redirect(url_for("manage_users"))

    can_access_reports = request.form.get("can_access_reports") == "1"
    can_access_dashboard = request.form.get("can_access_dashboard") == "1"

    if not user["is_admin"] and not (can_access_reports or can_access_dashboard):
        flash("Selecione ao menos um acesso (Relatórios ou Dashboard).", "error")
        return redirect(url_for("manage_users"))

    try:
        user_store.update_permissions(
            user_id,
            can_access_reports=can_access_reports,
            can_access_dashboard=can_access_dashboard,
        )
        flash("Permissões atualizadas.", "success")
    except ValueError as exc:
        flash(str(exc), "error")
    return redirect(url_for("manage_users"))


@app.post("/api/upload")
@reports_access_required
def upload_dataset():
    if "file" not in request.files:
        return jsonify({"error": "Nenhum arquivo foi enviado."}), 400

    uploaded = request.files["file"]
    filename = secure_filename(uploaded.filename or "dataset")

    try:
        dataframe = load_dataframe(filename, uploaded.read())
    except DataLoaderError as exc:
        return jsonify({"error": str(exc)}), 400

    dataset = datasets.create(filename, dataframe)

    response = {
        "datasetId": dataset["id"],
        "name": dataset["name"],
        "columns": dataset["columns"],
        "dimensions": dataset["dimensions"],
        "measures": dataset["measures"],
        "aggregations": available_aggregations(),
        "rowCount": dataset["row_count"],
        "schema": dataset["schema"],
    }
    return jsonify(response)


@app.post("/api/pivot")
@reports_access_required
def pivot_endpoint():
    payload = request.get_json(silent=True) or {}

    dataset_id = payload.get("datasetId")
    rows = payload.get("rows", [])
    columns = payload.get("columns", [])
    measures_payload = payload.get("measures")
    if measures_payload is None and "measure" in payload:
        measures_payload = payload.get("measure")
    measures = _normalize_measures(measures_payload)
    aggregator = payload.get("aggregator", "sum")
    filters = _normalize_filters(payload.get("filters", {}))
    try:
        pre_calcs = _normalize_calculations(payload.get("preCalculations"), "preCalculations")
        post_calcs = _normalize_calculations(payload.get("postCalculations"), "postCalculations")
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if not dataset_id:
        return jsonify({"error": "datasetId é obrigatório."}), 400

    try:
        dataset = datasets.get(dataset_id)
    except KeyError:
        return jsonify({"error": "Dataset não encontrado ou expirado."}), 404

    if not measures:
        return jsonify({"error": "É necessário escolher pelo menos uma medida numérica."}), 400

    filtered_frame = _apply_filters(dataset["frame"], filters)
    if filtered_frame.empty:
        return jsonify({"error": "Nenhum dado corresponde aos filtros aplicados."}), 400

    try:
        filtered_frame = apply_pre_calculations(filtered_frame, pre_calcs)
    except CalculationError as exc:
        return jsonify({"error": str(exc)}), 400

    try:
        pivot = build_pivot(
            dataset_id=dataset_id,
            frame=filtered_frame,
            rows=rows,
            columns=columns,
            measure=measures,
            aggregator=aggregator,
        )
        pivot.calculations["pre"] = copy.deepcopy(pre_calcs)
        pivot = apply_post_calculations(pivot, post_calcs)
    except (PivotError, CalculationError) as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        app.logger.exception("Erro inesperado durante a geração do pivot")
        return jsonify({"error": "Erro interno ao gerar a tabela dinâmica."}), 500

    response = pivot.as_dict()
    response["filters"] = filters
    return jsonify(response)


@app.get("/api/filter-values")
@reports_access_required
def filter_values_endpoint():
    dataset_id = request.args.get("datasetId")
    field = request.args.get("field")

    if not dataset_id or not field:
        return jsonify({"error": "datasetId e field são obrigatórios."}), 400

    try:
        dataset = datasets.get(dataset_id)
    except KeyError:
        return jsonify({"error": "Dataset não encontrado ou expirado."}), 404

    frame = dataset["frame"]
    if field not in frame.columns:
        return jsonify({"error": "Campo inválido para filtros."}), 400

    values = frame[field].dropna().astype(str).unique().tolist()
    values.sort()
    return jsonify({"values": values})


@app.post("/api/dashboard/upload")
@dashboard_access_required
def dashboard_upload():
    if "file" not in request.files:
        return jsonify({"error": "Nenhum arquivo foi enviado."}), 400

    uploaded = request.files["file"]
    filename = secure_filename(uploaded.filename or "planilha_despesas.xlsx")

    try:
        dashboard_manager.reset()
        dataframe = load_dataframe(filename, uploaded.read())
        dataset = dashboard_manager.load_dataset(filename, dataframe)
    except (DataLoaderError, DashboardError) as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        app.logger.exception("Erro inesperado ao carregar base do dashboard")
        return jsonify({"error": "Erro interno ao carregar a base para o dashboard."}), 500
    try:
        _persist_unb_dashboard_dataset(dataset)
    except Exception:
        return jsonify({"error": "Base processada, porém não foi possível atualizar o dashboard UnB."}), 500

    return jsonify(
        {
            "dataset": {"id": dataset.id, "name": dataset.name},
            "datasets": dashboard_manager.datasets(),
            "warnings": dataset.warnings,
            "config": _dashboard_config(),
            "columnMap": dataset.column_map,
        }
    )


@app.post("/api/dashboard/query")
@dashboard_access_required
def dashboard_query():
    payload = request.get_json(silent=True) or {}
    dataset_id = payload.get("datasetId")
    try:
        view = dashboard_manager.prepare_view(dataset_id, payload)
    except DashboardError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        app.logger.exception("Erro inesperado ao gerar dashboard")
        return jsonify({"error": "Erro interno ao gerar o dashboard."}), 500
    view["config"] = _dashboard_config()
    return jsonify(view)


@app.get("/api/dashboard")
@dashboard_access_required
def dashboard_data_endpoint():
    dataset_id = request.args.get("datasetId")
    try:
        view = dashboard_manager.prepare_view(dataset_id, {"datasetId": dataset_id})
    except DashboardError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        app.logger.exception("Erro inesperado ao gerar dashboard (GET)")
        return jsonify({"error": "Erro interno ao gerar o dashboard."}), 500
    view["config"] = _dashboard_config()
    return jsonify(view)


@app.post("/api/dashboard/export")
@dashboard_access_required
def dashboard_export():
    payload = request.get_json(silent=True) or {}
    dataset_id = payload.get("datasetId")
    target = payload.get("target", "table")
    export_format = (payload.get("format") or "csv").lower()

    try:
        buffer, filename, mimetype = dashboard_manager.export(dataset_id, payload, target, export_format)
    except DashboardError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        app.logger.exception("Erro inesperado ao exportar dados do dashboard")
        return jsonify({"error": "Erro interno ao exportar os dados."}), 500

    buffer.seek(0)
    return send_file(buffer, mimetype=mimetype, as_attachment=True, download_name=filename)


@app.delete("/api/dashboard/dataset/<dataset_id>")
@dashboard_access_required
def dashboard_delete_dataset(dataset_id: str):
    dashboard_manager.remove(dataset_id)
    datasets_list = dashboard_manager.datasets()
    response: Dict[str, Any] = {"datasets": datasets_list}
    if datasets_list:
        try:
            default_id = datasets_list[0]["id"]
            view = dashboard_manager.prepare_view(default_id, {"datasetId": default_id})
            view["config"] = _dashboard_config()
            response["view"] = view
        except DashboardError:
            response["view"] = None
    else:
        response["view"] = None
    return jsonify(response)


@app.post("/api/export")
@reports_access_required
def export_pivot():
    payload = request.get_json(silent=True) or {}

    dataset_id = payload.get("datasetId")
    rows = payload.get("rows", [])
    columns = payload.get("columns", [])
    measures_payload = payload.get("measures")
    if measures_payload is None and "measure" in payload:
        measures_payload = payload.get("measure")
    measures = _normalize_measures(measures_payload)
    aggregator = payload.get("aggregator", "sum")
    filters = _normalize_filters(payload.get("filters", {}))
    fmt = (payload.get("format") or "excel").lower()

    try:
        pre_calcs = _normalize_calculations(payload.get("preCalculations"), "preCalculations")
        post_calcs = _normalize_calculations(payload.get("postCalculations"), "postCalculations")
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if not dataset_id:
        return jsonify({"error": "datasetId é obrigatório."}), 400

    try:
        dataset = datasets.get(dataset_id)
    except KeyError:
        return jsonify({"error": "Dataset não encontrado ou expirado."}), 404

    if not measures:
        return jsonify({"error": "É necessário escolher pelo menos uma medida numérica."}), 400

    filtered_frame = _apply_filters(dataset["frame"], filters)
    if filtered_frame.empty:
        return jsonify({"error": "Nenhum dado corresponde aos filtros aplicados."}), 400

    try:
        filtered_frame = apply_pre_calculations(filtered_frame, pre_calcs)
    except CalculationError as exc:
        return jsonify({"error": str(exc)}), 400

    try:
        pivot = build_pivot(
            dataset_id=dataset_id,
            frame=filtered_frame,
            rows=rows,
            columns=columns,
            measure=measures,
            aggregator=aggregator,
        )
        pivot.calculations["pre"] = copy.deepcopy(pre_calcs)
        pivot = apply_post_calculations(pivot, post_calcs)
    except (PivotError, CalculationError) as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        app.logger.exception("Erro inesperado durante a exportação do pivot")
        return jsonify({"error": "Erro interno ao gerar a exportação."}), 500

    df = pivot_result_to_dataframe(pivot)

    if fmt == "excel":
        buffer = io.BytesIO()
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="Pivot")
        buffer.seek(0)
        filename = f"pivot_{dataset_id}.xlsx"
        return send_file(
            buffer,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True,
            download_name=filename,
        )

    if fmt == "pdf":
        pdf = FPDF()
        pdf.set_auto_page_break(auto=True, margin=15)
        pdf.add_page()
        pdf.set_font("Arial", "B", 12)
        pdf.cell(0, 10, "Tabela Dinâmica", ln=True)
        pdf.ln(4)
        pdf.set_font("Arial", size=9)

        def _to_latin(value):
            if value is None:
                return ''
            return str(value).encode('latin-1', 'ignore').decode('latin-1')

        columns = [_to_latin(col) for col in df.columns]
        page_width = pdf.w - 2 * pdf.l_margin
        col_width = page_width / max(len(columns), 1)

        for column in columns:
            pdf.cell(col_width, 8, column, border=1, align='C')
        pdf.ln()

        for _, row in df.iterrows():
            for original_column in df.columns:
                value = '' if pd.isna(row[original_column]) else _to_latin(row[original_column])
                pdf.cell(col_width, 8, value, border=1)
            pdf.ln()

        pdf_output = pdf.output(dest='S')
        if isinstance(pdf_output, str):
            pdf_bytes = pdf_output.encode('latin-1', 'ignore')
        else:
            pdf_bytes = pdf_output
        buffer = io.BytesIO(pdf_bytes)
        buffer.seek(0)
        filename = f"pivot_{dataset_id}.pdf"
        return send_file(buffer, mimetype='application/pdf', as_attachment=True, download_name=filename)

    return jsonify({"error": "Formato de exportação inválido."}), 400





@app.get("/api/datasets")
@reports_access_required
def list_datasets():
    return jsonify({"datasets": datasets.ids()})


@app.delete("/api/dataset/<dataset_id>")
@reports_access_required
def delete_dataset(dataset_id: str):
    datasets.delete(dataset_id)
    return "", 204


def create_app() -> Flask:
    return app


if __name__ == "__main__":
    app.run(debug=True)
