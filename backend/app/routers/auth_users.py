"""Authentication, user management, and organization-scoped global search endpoints."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import desc, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings

from app.database import get_db
from app.models import Machine
from app.models_ps032 import Abnormality, HandoverRecord, MachineTask, OperatorAssignment, ProductionEntry, UserAccount
from app.schemas_ps032 import LoginRequest, UserCreateRequest, UserDTO, UserUpdateRequest
from app.services.access_control import (
    assert_user_management_scope,
    get_permitted_factory_ids,
    get_permitted_machine_ids,
)
from app.services.auth_service import (
    COOKIE_NAME,
    SUPERVISORY_ROLES,
    create_access_token,
    get_optional_user,
    normalize_role,
    record_audit_event,
    require_current_user,
    require_roles,
)

router = APIRouter(prefix="/api", tags=["auth-users"])


@router.post("/login")
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    user = db.scalar(select(UserAccount).where(UserAccount.email == email))
    if not user or not user.check_password(payload.password):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is inactive.")

    settings = get_settings()
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    is_secure = settings.cookie_secure if settings.cookie_secure is not None else (proto == "https")

    token = create_access_token(user)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=is_secure,
        samesite=settings.cookie_samesite,
        max_age=60 * 60 * 12,
    )
    record_audit_event(
        db,
        action="user_login",
        entity_type="user",
        entity_id=str(user.id),
        details=f"User {user.email} ({user.role}) logged in.",
        user=user,
    )
    db.commit()
    return {
        "message": "Login successful",
        "access_token": token,
        "token_type": "bearer",
        "user": UserDTO.model_validate(user).model_dump(mode="json"),
    }


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    user: Optional[UserAccount] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    is_secure = settings.cookie_secure if settings.cookie_secure is not None else (proto == "https")
    response.delete_cookie(COOKIE_NAME, secure=is_secure, samesite=settings.cookie_samesite)
    if user:
        record_audit_event(
            db,
            action="user_logout",
            entity_type="user",
            entity_id=str(user.id),
            details=f"User {user.email} logged out.",
            user=user,
        )
        db.commit()
    return {"message": "Logout successful"}


@router.get("/me")
def get_me(user: Optional[UserAccount] = Depends(get_optional_user)):
    if user is None:
        return {"authenticated": False, "user": None}
    return {"authenticated": True, "user": UserDTO.model_validate(user).model_dump(mode="json")}


@router.get("/users", response_model=list[UserDTO])
def list_users(
    q: str = Query(default=""),
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    actor: UserAccount = Depends(require_roles(*SUPERVISORY_ROLES)),
    db: Session = Depends(get_db),
):
    stmt = select(UserAccount).order_by(UserAccount.name.asc())
    actor_role = normalize_role(actor.role)
    if actor_role == "regional_manager":
        if not actor.assigned_region_id:
            return []
        stmt = stmt.where(UserAccount.assigned_region_id == actor.assigned_region_id)
    elif actor_role == "factory_supervisor":
        if not actor.assigned_factory_id:
            return []
        stmt = stmt.where(UserAccount.assigned_factory_id == actor.assigned_factory_id)

    if role:
        stmt = stmt.where(UserAccount.role == normalize_role(role))
    if is_active is not None:
        stmt = stmt.where(UserAccount.is_active.is_(is_active))
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                UserAccount.name.ilike(like),
                UserAccount.employee_id.ilike(like),
                UserAccount.email.ilike(like),
            )
        )
    return [UserDTO.model_validate(u) for u in db.scalars(stmt)]


@router.post("/users", response_model=UserDTO, status_code=201)
def create_user(
    payload: UserCreateRequest,
    actor: UserAccount = Depends(require_roles(*SUPERVISORY_ROLES)),
    db: Session = Depends(get_db),
):
    target_role = normalize_role(payload.role)
    target_region = payload.assigned_region_id or actor.assigned_region_id
    target_factory = payload.assigned_factory_id or (actor.assigned_factory_id if normalize_role(actor.role) == "factory_supervisor" else None)
    assert_user_management_scope(actor, target_role, target_region, target_factory)

    email = payload.email.strip().lower()
    if db.scalar(select(UserAccount).where(UserAccount.email == email)):
        raise HTTPException(status_code=409, detail="A user with this email already exists.")
    if payload.employee_id and db.scalar(select(UserAccount).where(UserAccount.employee_id == payload.employee_id)):
        raise HTTPException(status_code=409, detail="A user with this employee ID already exists.")

    user = UserAccount(
        name=payload.name.strip(),
        email=email,
        role=target_role,
        employee_id=payload.employee_id,
        assigned_region_id=target_region,
        assigned_factory_id=target_factory,
    )
    user.set_password(payload.password)
    db.add(user)
    db.flush()
    record_audit_event(
        db,
        action="user_created",
        entity_type="user",
        entity_id=str(user.id),
        factory_id=user.assigned_factory_id,
        region_id=user.assigned_region_id,
        details=f"Created industrial user {user.email} with role {user.role}.",
        user=actor,
    )
    db.commit()
    db.refresh(user)
    return UserDTO.model_validate(user)


@router.put("/users/{user_id}", response_model=UserDTO)
def update_user(
    user_id: int,
    payload: UserUpdateRequest,
    actor: UserAccount = Depends(require_roles(*SUPERVISORY_ROLES)),
    db: Session = Depends(get_db),
):
    user = db.get(UserAccount, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    assert_user_management_scope(actor, user.role, user.assigned_region_id, user.assigned_factory_id)
    next_role = normalize_role(payload.role) if payload.role is not None else user.role
    next_region = payload.assigned_region_id if payload.assigned_region_id is not None else user.assigned_region_id
    next_factory = payload.assigned_factory_id if payload.assigned_factory_id is not None else user.assigned_factory_id
    assert_user_management_scope(actor, next_role, next_region, next_factory)

    if user.id == actor.id and payload.role is not None and next_role != user.role:
        raise HTTPException(status_code=403, detail="Users cannot modify their own role.")
    if user.id == actor.id and payload.is_active is False:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own active account.")

    if payload.name is not None:
        user.name = payload.name.strip()
    if payload.role is not None:
        user.role = next_role
    if payload.employee_id is not None:
        user.employee_id = payload.employee_id
    if payload.assigned_region_id is not None:
        user.assigned_region_id = next_region
    if payload.assigned_factory_id is not None:
        user.assigned_factory_id = next_factory
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.password:
        user.set_password(payload.password)

    record_audit_event(
        db,
        action="user_updated",
        entity_type="user",
        entity_id=str(user.id),
        factory_id=user.assigned_factory_id,
        region_id=user.assigned_region_id,
        details=f"Updated user {user.email} (role={user.role}, active={user.is_active}).",
        user=actor,
    )
    db.commit()
    db.refresh(user)
    return UserDTO.model_validate(user)


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    actor: UserAccount = Depends(require_roles("company_admin")),
    db: Session = Depends(get_db),
):
    if user_id == actor.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own active admin account.")
    user = db.get(UserAccount, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    record_audit_event(
        db,
        action="user_deleted",
        entity_type="user",
        entity_id=str(user_id),
        details=f"Deleted user {user.email}.",
        user=actor,
    )
    db.commit()
    return {"message": f"User {user.email} deleted successfully."}


@router.get("/users/{user_id}/history")
def get_user_history(
    user_id: int,
    actor: UserAccount = Depends(require_roles(*SUPERVISORY_ROLES)),
    db: Session = Depends(get_db),
):
    target = db.get(UserAccount, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    assert_user_management_scope(actor, target.role, target.assigned_region_id, target.assigned_factory_id)

    assignments = list(
        db.scalars(
            select(OperatorAssignment).where(OperatorAssignment.user_id == user_id).order_by(desc(OperatorAssignment.created_at))
        )
    )
    prod = list(
        db.scalars(
            select(ProductionEntry).where(ProductionEntry.operator_id == user_id).order_by(desc(ProductionEntry.recorded_at)).limit(20)
        )
    )
    handovers = list(
        db.scalars(
            select(HandoverRecord)
            .where(or_(HandoverRecord.outgoing_operator == target.name, HandoverRecord.acknowledged_by_user_id == user_id))
            .order_by(desc(HandoverRecord.created_at))
            .limit(20)
        )
    )
    return {
        "user": UserDTO.model_validate(target).model_dump(mode="json"),
        "assignments": [
            {
                "id": a.id,
                "machine_id": a.machine_id,
                "line_id": a.line_id,
                "factory_id": a.factory_id,
                "shift_name": a.shift_name,
                "is_active": a.is_active,
                "assigned_by_name": a.assigned_by_name,
                "created_at": a.created_at,
            }
            for a in assignments
        ],
        "production_entries": [
            {"id": p.id, "machine_id": p.machine_id, "shift_name": p.shift_name, "units_produced": p.units_produced, "recorded_at": p.recorded_at}
            for p in prod
        ],
        "handovers": [
            {"id": h.id, "machine_id": h.machine_id, "status": h.status, "previous_shift_name": h.previous_shift_name, "incoming_shift_name": h.incoming_shift_name, "created_at": h.created_at}
            for h in handovers
        ],
    }


@router.get("/search")
def global_search(
    q: str = Query(default=""),
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    term = q.strip()
    if not term:
        return {"users": [], "tasks": [], "machines": [], "abnormalities": []}

    like = f"%{term}%"
    role = normalize_role(user.role)
    permitted_machines = get_permitted_machine_ids(db, user)

    users_out = []
    if role in SUPERVISORY_ROLES:
        u_stmt = select(UserAccount).where(or_(UserAccount.name.ilike(like), UserAccount.employee_id.ilike(like)))
        if role == "regional_manager" and user.assigned_region_id:
            u_stmt = u_stmt.where(UserAccount.assigned_region_id == user.assigned_region_id)
        elif role == "factory_supervisor" and user.assigned_factory_id:
            u_stmt = u_stmt.where(UserAccount.assigned_factory_id == user.assigned_factory_id)
        users_out = [UserDTO.model_validate(u).model_dump(mode="json") for u in db.scalars(u_stmt.limit(10))]

    tasks_stmt = select(MachineTask).where(or_(MachineTask.title.ilike(like), MachineTask.description.ilike(like)))
    if role not in SUPERVISORY_ROLES:
        tasks_stmt = tasks_stmt.where(MachineTask.assigned_to == user.id)
    tasks = list(db.scalars(tasks_stmt.limit(10)))

    m_stmt = select(Machine).where(or_(Machine.name.ilike(like), Machine.code.ilike(like), Machine.qr_token.ilike(like)))
    if permitted_machines is not None:
        m_stmt = m_stmt.where(Machine.id.in_(permitted_machines)) if permitted_machines else m_stmt.where(Machine.id == "__none__")
    machines = list(db.scalars(m_stmt.limit(10)))

    a_stmt = select(Abnormality).where(or_(Abnormality.title.ilike(like), Abnormality.code.ilike(like)))
    if permitted_machines is not None:
        a_stmt = a_stmt.where(Abnormality.machine_id.in_(permitted_machines)) if permitted_machines else a_stmt.where(Abnormality.id == -1)
    abnormalities = list(db.scalars(a_stmt.limit(10)))

    return {
        "users": users_out,
        "tasks": [{"id": t.id, "title": t.title, "status": t.status, "machine_id": t.machine_id} for t in tasks],
        "machines": [{"id": m.id, "code": m.code, "name": m.name, "qr_token": m.qr_token} for m in machines],
        "abnormalities": [{"id": a.id, "code": a.code, "title": a.title, "status": a.status} for a in abnormalities],
    }
