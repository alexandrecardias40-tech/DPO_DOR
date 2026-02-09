from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional

from werkzeug.security import check_password_hash, generate_password_hash


def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "username": row["username"],
        "normalized_username": row["normalized_username"],
        "password_hash": row["password_hash"],
        "is_admin": bool(row["is_admin"]),
        "must_change_password": bool(row["must_change_password"]),
        "can_access_reports": bool(row["can_access_reports"]),
        "can_access_dashboard": bool(row["can_access_dashboard"]),
        "created_at": row["created_at"],
    }


class UserStore:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _initialize(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    normalized_username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    is_admin INTEGER NOT NULL DEFAULT 0,
                    must_change_password INTEGER NOT NULL DEFAULT 1,
                    can_access_reports INTEGER NOT NULL DEFAULT 1,
                    can_access_dashboard INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_users_normalized
                ON users (normalized_username)
                """
            )
            existing_columns = {
                row["name"] for row in conn.execute("PRAGMA table_info(users)")
            }
            if "can_access_reports" not in existing_columns:
                conn.execute(
                    "ALTER TABLE users ADD COLUMN can_access_reports INTEGER NOT NULL DEFAULT 1"
                )
            if "can_access_dashboard" not in existing_columns:
                conn.execute(
                    "ALTER TABLE users ADD COLUMN can_access_dashboard INTEGER NOT NULL DEFAULT 1"
                )

    @staticmethod
    def _normalize_username(username: str) -> str:
        return (username or "").strip().lower()

    def list_users(self) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, username, normalized_username, password_hash, is_admin, must_change_password, can_access_reports, can_access_dashboard, created_at "
                "FROM users ORDER BY username ASC"
            ).fetchall()
        return [_row_to_dict(row) for row in rows]

    def get_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, username, normalized_username, password_hash, is_admin, must_change_password, can_access_reports, can_access_dashboard, created_at "
                "FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
        return None if row is None else _row_to_dict(row)

    def get_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        normalized = self._normalize_username(username)
        if not normalized:
            return None
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, username, normalized_username, password_hash, is_admin, must_change_password, can_access_reports, can_access_dashboard, created_at "
                "FROM users WHERE normalized_username = ?",
                (normalized,),
            ).fetchone()
        return None if row is None else _row_to_dict(row)

    def authenticate(self, username: str, password: str) -> Optional[Dict[str, Any]]:
        user = self.get_by_username(username)
        if not user:
            return None
        if not password or not check_password_hash(user["password_hash"], password):
            return None
        return user

    def create_user(
        self,
        username: str,
        password: str,
        *,
        is_admin: bool = False,
        must_change_password: bool = True,
        can_access_reports: bool = True,
        can_access_dashboard: bool = True,
    ) -> Dict[str, Any]:
        username = (username or "").strip()
        if not username:
            raise ValueError("O usuário precisa de um nome.")
        if not password or len(password) < 6:
            raise ValueError("A senha precisa ter pelo menos 6 caracteres.")

        normalized = self._normalize_username(username)
        password_hash = generate_password_hash(password)
        if is_admin:
            can_access_reports = True
            can_access_dashboard = True

        with self._connect() as conn:
            try:
                cursor = conn.execute(
                    """
                    INSERT INTO users (
                        username,
                        normalized_username,
                        password_hash,
                        is_admin,
                        must_change_password,
                        can_access_reports,
                        can_access_dashboard
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        username,
                        normalized,
                        password_hash,
                        int(is_admin),
                        int(must_change_password),
                        int(bool(can_access_reports)),
                        int(bool(can_access_dashboard)),
                    ),
                )
                user_id = cursor.lastrowid
            except sqlite3.IntegrityError as exc:
                raise ValueError("Nome de usuário já existe.") from exc

        user = self.get_by_id(int(user_id))
        if user is None:
            raise RuntimeError("Falha ao criar usuário.")
        return user

    def update_password(self, user_id: int, new_password: str, *, must_change_password: bool = False) -> None:
        if not new_password or len(new_password) < 6:
            raise ValueError("A senha precisa ter pelo menos 6 caracteres.")
        password_hash = generate_password_hash(new_password)
        with self._connect() as conn:
            conn.execute(
                "UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?",
                (password_hash, int(must_change_password), user_id),
            )

    def require_password_change(self, user_id: int) -> None:
        with self._connect() as conn:
            conn.execute("UPDATE users SET must_change_password = 1 WHERE id = ?", (user_id,))

    def delete_user(self, user_id: int) -> None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT is_admin FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            if row is None:
                return
            if row["is_admin"]:
                admin_count = conn.execute("SELECT COUNT(*) FROM users WHERE is_admin = 1").fetchone()[0]
                if admin_count <= 1:
                    raise ValueError("Não é possível remover o último administrador.")
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))

    def ensure_admin(self, username: str, password: str) -> Dict[str, Any]:
        username = (username or "admin").strip()
        password = password or "senha123"

        existing_admins = [user for user in self.list_users() if user["is_admin"]]
        if not existing_admins:
            return self.create_user(
                username,
                password,
                is_admin=True,
                must_change_password=True,
                can_access_reports=True,
                can_access_dashboard=True,
            )

        existing = self.get_by_username(username)
        if existing is None:
            return self.create_user(
                username,
                password,
                is_admin=True,
                must_change_password=True,
                can_access_reports=True,
                can_access_dashboard=True,
            )
        if not existing["is_admin"]:
            with self._connect() as conn:
                conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (existing["id"],))
            existing["is_admin"] = True
        try:
            self.update_permissions(
                existing["id"], can_access_reports=True, can_access_dashboard=True
            )
        except ValueError:
            pass
        else:
            existing["can_access_reports"] = True
            existing["can_access_dashboard"] = True
        return existing

    def update_permissions(
        self,
        user_id: int,
        *,
        can_access_reports: Optional[bool] = None,
        can_access_dashboard: Optional[bool] = None,
    ) -> None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT is_admin FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            if row is None:
                raise ValueError("Usuário não encontrado.")
            is_admin = bool(row["is_admin"])

            assignments: List[str] = []
            params: List[int] = []

            if is_admin:
                assignments.extend(
                    [
                        "can_access_reports = 1",
                        "can_access_dashboard = 1",
                    ]
                )
            else:
                if can_access_reports is not None:
                    assignments.append("can_access_reports = ?")
                    params.append(int(bool(can_access_reports)))
                if can_access_dashboard is not None:
                    assignments.append("can_access_dashboard = ?")
                    params.append(int(bool(can_access_dashboard)))

            if not assignments:
                return

            params.append(user_id)
            conn.execute(
                f"UPDATE users SET {', '.join(assignments)} WHERE id = ?",
                params,
            )
