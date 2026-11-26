"""Authentication, RBAC permissions, and immutable audit trail services."""

from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional
from fastapi import Cookie, Depends, Header, HTTPException, Request
import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models_ps032 import AuditEvent, UserAccount


COOKIE_NAME = "ps032_access_token"

ROLE_ALIASES = {
    "admin": "company_admin",
    "employee": "operator",
}

SUPERVISORY_ROLES = {"company_admin", "regional_manager", "factory_supervisor"}
HANDOVER_ACK_ROLES = {"company_admin", "regional_manager", "factory_supervisor", "operator", "maintenance_engineer"}


def normalize_role(role: str) -> str:
    r = role.strip().lower()
    return ROLE_ALIASES.get(r, r)


def create_access_token(user: UserAccount) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "employee_id": user.employee_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_expire_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> Optional[dict]:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except Exception:
        return None


def get_optional_user(
    authorization: Optional[str] = Header(default=None),
    ps032_access_token: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
) -> Optional[UserAccount]:
    token: Optional[str] = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif ps032_access_token:
        token = ps032_access_token

    if not token:
        return None

    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        return None

    try:
        user_id = int(payload["sub"])
    except (TypeError, ValueError):
        return None

    user = db.get(UserAccount, user_id)
    if not user or not user.is_active:
        return None
    return user


def require_current_user(user: Optional[UserAccount] = Depends(get_optional_user)) -> UserAccount:
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required. Please log in.")
    return user


def require_roles(*allowed_roles: str):
    allowed = {normalize_role(r) for r in allowed_roles}

    def dependency(user: UserAccount = Depends(require_current_user)) -> UserAccount:
        if normalize_role(user.role) not in allowed:
            raise HTTPException(
                status_code=403,
                detail=f"Forbidden: role '{user.role}' lacks permission for this action.",
            )
        return user

    return dependency


def record_audit_event(
    db: Session,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    details: str,
    user: Optional[UserAccount] = None,
    machine_id: Optional[str] = None,
    factory_id: Optional[str] = None,
    region_id: Optional[str] = None,
    metadata_json: Optional[dict] = None,
) -> AuditEvent:
    ev = AuditEvent(
        actor_user_id=user.id if user else None,
        actor_name=user.name if user else "System",
        actor_role=user.role if user else "system",
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id),
        machine_id=machine_id,
        factory_id=factory_id,
        region_id=region_id,
        details=details,
        metadata_json=metadata_json,
    )
    db.add(ev)
    return ev

