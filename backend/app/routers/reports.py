"""Centralized PS-032 Industrial Reports, Preview & One-Click PDF/ZIP Download APIs."""

from typing import Optional
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models_ps032 import UserAccount
from app.services.auth_service import record_audit_event, require_current_user
from app.services.reports_service import (
    build_report_preview_payload,
    query_centralized_reports,
    render_bulk_reports_export,
    render_individual_report_pdf_bytes,
)

router = APIRouter(prefix="/api/ps032/reports", tags=["ps032-reports"])


@router.get("")
def list_centralized_reports(
    region_id: Optional[str] = None,
    factory_id: Optional[str] = None,
    line_id: Optional[str] = None,
    machine_id: Optional[str] = None,
    category: Optional[str] = None,
    status: Optional[str] = None,
    shift_name: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    return query_centralized_reports(
        db,
        user,
        region_id=region_id,
        factory_id=factory_id,
        line_id=line_id,
        machine_id=machine_id,
        category=category,
        status=status,
        shift_name=shift_name,
        start_date=start_date,
        end_date=end_date,
    )


@router.get("/preview/{report_uid}")
def preview_report(
    report_uid: str,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    payload = build_report_preview_payload(db, user, report_uid)
    rep = payload["report"]
    record_audit_event(
        db,
        action="report_viewed",
        entity_type="report",
        entity_id=report_uid,
        machine_id=rep.get("machine_id"),
        factory_id=rep.get("factory_id"),
        region_id=rep.get("region_id"),
        details=f"Viewed report preview '{rep['title']}' ({rep['category']}).",
        user=user,
    )
    db.commit()
    return payload


@router.get("/download/{report_uid}")
def download_individual_report(
    report_uid: str,
    inline: bool = Query(default=False),
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    pdf_bytes, filename, rep = render_individual_report_pdf_bytes(db, user, report_uid)
    record_audit_event(
        db,
        action="report_downloaded_individual",
        entity_type="report",
        entity_id=report_uid,
        machine_id=rep.get("machine_id"),
        factory_id=rep.get("factory_id"),
        region_id=rep.get("region_id"),
        details=f"Downloaded individual PDF '{filename}' for report {report_uid}.",
        user=user,
    )
    db.commit()
    disp = "inline" if inline else "attachment"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'{disp}; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/bulk-download")
def bulk_download_reports(
    scope: str = Query(default="company"),
    format: str = Query(default="pdf"),
    region_id: Optional[str] = None,
    factory_id: Optional[str] = None,
    line_id: Optional[str] = None,
    machine_id: Optional[str] = None,
    category: Optional[str] = None,
    status: Optional[str] = None,
    shift_name: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    content, filename, media_type, summary = render_bulk_reports_export(
        db,
        user,
        scope=scope,
        export_format=format,
        region_id=region_id,
        factory_id=factory_id,
        line_id=line_id,
        machine_id=machine_id,
        category=category,
        status=status,
        shift_name=shift_name,
        start_date=start_date,
        end_date=end_date,
    )
    action_map = {
        "factory": "factory_report_downloaded",
        "region": "region_report_downloaded",
        "company": "company_report_downloaded",
    }
    audit_action = "zip_export_downloaded" if format == "zip" else action_map.get(scope, "company_report_downloaded")
    record_audit_event(
        db,
        action=audit_action,
        entity_type="report_bundle",
        entity_id=filename,
        machine_id=machine_id,
        factory_id=factory_id,
        region_id=region_id,
        details=f"Downloaded {scope} {format.upper()} bundle '{filename}' ({summary['total_reports']} reports, role={user.role}).",
        user=user,
    )
    db.commit()
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )
