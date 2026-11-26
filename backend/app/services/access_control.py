"""Strict role-based + machine/organization-scoped access control enforcement."""

from datetime import datetime, timezone
from typing import Optional
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Factory, Machine, ProductionLine
from app.models_ps032 import HandoverRecord, MaintenanceSchedule, OperatorAssignment, UserAccount
from app.services.auth_service import normalize_role


def _assignment_within_dates(a: OperatorAssignment, today_str: str) -> bool:
    if a.start_date and today_str < a.start_date:
        return False
    if a.end_date and today_str > a.end_date:
        return False
    return True


def get_permitted_machine_ids(db: Session, user: UserAccount) -> Optional[set[str]]:
    """Return None for unrestricted company_admin, or the exact set of permitted machine IDs."""
    role = normalize_role(user.role)
    if role == "company_admin":
        return None

    if role == "regional_manager":
        if not user.assigned_region_id:
            return set()
        rows = db.scalars(
            select(Machine.id)
            .join(ProductionLine, Machine.line_id == ProductionLine.id)
            .join(Factory, ProductionLine.factory_id == Factory.id)
            .where(Factory.region_id == user.assigned_region_id)
        )
        return set(rows)

    if role == "factory_supervisor":
        if not user.assigned_factory_id:
            return set()
        rows = db.scalars(
            select(Machine.id)
            .join(ProductionLine, Machine.line_id == ProductionLine.id)
            .where(ProductionLine.factory_id == user.assigned_factory_id)
        )
        return set(rows)

    # operator or maintenance_engineer -> strictly bound to active OperatorAssignment rows
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    assignments = list(
        db.scalars(
            select(OperatorAssignment).where(
                OperatorAssignment.user_id == user.id,
                OperatorAssignment.is_active.is_(True),
            )
        )
    )
    permitted: set[str] = set()
    for a in assignments:
        if not _assignment_within_dates(a, today_str):
            continue
        if a.machine_id:
            permitted.add(a.machine_id)
        elif a.line_id:
            permitted.update(db.scalars(select(Machine.id).where(Machine.line_id == a.line_id)))
        elif a.factory_id:
            permitted.update(
                db.scalars(
                    select(Machine.id)
                    .join(ProductionLine, Machine.line_id == ProductionLine.id)
                    .where(ProductionLine.factory_id == a.factory_id)
                )
            )

    # Maintenance engineers also have access to machines on maintenance schedules assigned directly to them
    if role == "maintenance_engineer":
        sched_machines = db.scalars(
            select(MaintenanceSchedule.machine_id).where(MaintenanceSchedule.assigned_engineer_id == user.id)
        )
        permitted.update(sched_machines)

    return permitted


def get_permitted_factory_ids(db: Session, user: UserAccount) -> Optional[set[str]]:
    role = normalize_role(user.role)
    if role == "company_admin":
        return None
    if role == "regional_manager":
        if not user.assigned_region_id:
            return set()
        return set(db.scalars(select(Factory.id).where(Factory.region_id == user.assigned_region_id)))
    if role == "factory_supervisor":
        return {user.assigned_factory_id} if user.assigned_factory_id else set()

    machine_ids = get_permitted_machine_ids(db, user) or set()
    if not machine_ids:
        return set()
    return set(
        db.scalars(
            select(ProductionLine.factory_id)
            .join(Machine, Machine.line_id == ProductionLine.id)
            .where(Machine.id.in_(machine_ids))
        )
    )


def get_permitted_region_ids(db: Session, user: UserAccount) -> Optional[set[str]]:
    role = normalize_role(user.role)
    if role == "company_admin":
        return None
    if role == "regional_manager":
        return {user.assigned_region_id} if user.assigned_region_id else set()
    factory_ids = get_permitted_factory_ids(db, user) or set()
    if not factory_ids:
        return set()
    return set(db.scalars(select(Factory.region_id).where(Factory.id.in_(factory_ids))))


def assert_machine_access(db: Session, user: UserAccount, machine_id: str) -> None:
    permitted = get_permitted_machine_ids(db, user)
    if permitted is None:
        return
    if machine_id not in permitted:
        raise HTTPException(
            status_code=403,
            detail=f"Access denied: user '{user.email}' ({user.role}) is not assigned or authorized for machine '{machine_id}'.",
        )


def assert_factory_access(db: Session, user: UserAccount, factory_id: str) -> None:
    permitted = get_permitted_factory_ids(db, user)
    if permitted is None:
        return
    if factory_id not in permitted:
        raise HTTPException(
            status_code=403,
            detail=f"Access denied: user '{user.email}' ({user.role}) lacks access to factory '{factory_id}'.",
        )


def assert_region_access(db: Session, user: UserAccount, region_id: str) -> None:
    permitted = get_permitted_region_ids(db, user)
    if permitted is None:
        return
    if region_id not in permitted:
        raise HTTPException(
            status_code=403,
            detail=f"Access denied: user '{user.email}' ({user.role}) lacks access to region '{region_id}'.",
        )


def assert_handover_ack_access(db: Session, user: UserAccount, ho: HandoverRecord) -> None:
    assert_machine_access(db, user, ho.machine_id)
    role = normalize_role(user.role)
    if role == "operator":
        if ho.outgoing_operator == user.name:
            raise HTTPException(
                status_code=403,
                detail="Outgoing operator cannot acknowledge their own handover; incoming operator sign-off required.",
            )
        # Check shift assignment if operator has shift-specific bindings on this machine
        assignments = list(
            db.scalars(
                select(OperatorAssignment).where(
                    OperatorAssignment.user_id == user.id,
                    OperatorAssignment.is_active.is_(True),
                )
            )
        )
        shift_names = {a.shift_name for a in assignments if a.shift_name and (a.machine_id == ho.machine_id or a.machine_id is None)}
        designated_incoming = (ho.incoming_operator or "").strip().lower() == (user.name or "").strip().lower()
        if shift_names and ho.incoming_shift_name not in shift_names and not designated_incoming:
            raise HTTPException(
                status_code=403,
                detail=f"Access denied: operator is assigned to shift(s) {sorted(shift_names)}, not incoming shift '{ho.incoming_shift_name}'.",
            )


def assert_user_management_scope(
    actor: UserAccount,
    target_role: str,
    target_region_id: Optional[str],
    target_factory_id: Optional[str],
) -> None:
    actor_role = normalize_role(actor.role)
    norm_target_role = normalize_role(target_role)
    if actor_role == "company_admin":
        return
    if actor_role == "regional_manager":
        if norm_target_role in ("company_admin", "regional_manager"):
            raise HTTPException(status_code=403, detail="Regional Managers cannot create or promote Admin or Regional Manager accounts.")
        if actor.assigned_region_id and (not target_region_id or target_region_id != actor.assigned_region_id):
            raise HTTPException(status_code=403, detail="Regional Managers can only manage users within their assigned region.")
        return
    if actor_role == "factory_supervisor":
        if norm_target_role not in ("operator", "maintenance_engineer"):
            raise HTTPException(status_code=403, detail="Factory Supervisors can only manage operator and maintenance engineer accounts.")
        if actor.assigned_factory_id and (not target_factory_id or target_factory_id != actor.assigned_factory_id):
            raise HTTPException(status_code=403, detail="Factory Supervisors can only manage personnel in their assigned factory.")
        return
    raise HTTPException(status_code=403, detail="Insufficient role permissions for user management.")
