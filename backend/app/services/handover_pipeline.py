"""3-Stage Grounded Shift Handover Pipeline & Professional A4 ReportLab PDF Publisher."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.config import get_settings

SECTIONS = [
    "Completed",
    "In Progress",
    "Blockers/Escalations",
    "Watch-List",
]

STATUS_COMPLETED = {"closed", "resolved", "done", "completed", "acknowledged"}
STATUS_IN_PROGRESS = {"open", "in progress", "in_progress", "investigating", "submitted"}
STATUS_BLOCKERS = {"blocked", "escalated", "critical", "fault"}

# Usable A4 portrait width: 595.27 - 34 - 34 = 527.27 pt
CONTENT_WIDTH = 527.0


def _p(text: Any, style: ParagraphStyle) -> Paragraph:
    """Safely XML-escape text before passing to ReportLab Paragraph."""
    return Paragraph(escape(str(text if text is not None else "—")), style)


def _p_rich(markup: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(markup, style)


def parse_to_utc(dt_str: Any, default_tz: str = "UTC") -> Optional[datetime]:
    if not dt_str or not isinstance(dt_str, str):
        return None
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo(default_tz))
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def parse_shift_window(start_str: str, end_str: str, timezone_str: str = "Asia/Kolkata") -> Tuple[datetime, datetime]:
    try:
        tz = ZoneInfo(timezone_str)
    except Exception:
        tz = timezone.utc

    start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=tz)
    start_utc = start_dt.astimezone(timezone.utc)

    end_dt = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
    if end_dt.tzinfo is None:
        end_dt = end_dt.replace(tzinfo=tz)
    end_utc = end_dt.astimezone(timezone.utc)

    if start_utc >= end_utc:
        raise ValueError(f"Shift start ({start_utc}) must be strictly before shift end ({end_utc})")
    return start_utc, end_utc


def determine_section(event: Dict[str, Any]) -> str:
    status = str(event.get("status", "")).lower().strip()
    source = str(event.get("source", "")).lower().strip()
    assignee = event.get("assignee")
    severity = str(event.get("severity", "")).lower().strip()

    if source in ("slack", "chat", "cleaning_5s", "telemetry_watch") or status == "chat":
        return "Watch-List"
    if status in STATUS_COMPLETED:
        return "Completed"
    if status in STATUS_BLOCKERS or severity == "critical":
        return "Blockers/Escalations"
    if status in STATUS_IN_PROGRESS:
        if assignee is None or str(assignee).strip().lower() in ("", "unassigned", "none", "null"):
            return "Blockers/Escalations"
        return "In Progress"
    return "Watch-List"


def collapse_duplicate_records(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    grouped: Dict[Tuple[str, str], List[Dict[str, Any]]] = defaultdict(list)
    for ev in events:
        key = (str(ev.get("source", "unknown")).lower(), str(ev.get("record_id", "")).strip())
        grouped[key].append(ev)

    collapsed: List[Dict[str, Any]] = []
    for _, history in grouped.items():
        history_sorted = sorted(
            history,
            key=lambda x: x.get("parsed_datetime_utc") or datetime.min.replace(tzinfo=timezone.utc),
        )
        final_ev = dict(history_sorted[-1])
        final_ev["_history"] = history_sorted
        collapsed.append(final_ev)
    return collapsed


def format_item_text(event: Dict[str, Any], history: List[Dict[str, Any]]) -> str:
    record_id = event.get("record_id", "UNKNOWN")
    summary = str(event.get("summary", "No details")).strip()
    status = str(event.get("status", "unknown")).strip()
    source = str(event.get("source", "source")).strip()
    assignee = event.get("assignee")
    severity = event.get("severity")

    progression = []
    for h in history:
        st = h.get("status")
        if st and st not in progression:
            progression.append(st)
    prog_str = f" (Progression: {' -> '.join(progression)})" if len(progression) > 1 else ""

    if source in ("slack", "chat", "cleaning_5s"):
        return f"{record_id} — {summary}"

    details = []
    if status:
        details.append(f"Status: {status.title()}")
    if severity:
        details.append(f"Severity: {severity.upper()}")
    if assignee:
        details.append(f"Assignee: {assignee}")
    elif status not in STATUS_COMPLETED:
        details.append("Assignee: UNASSIGNED")

    details_str = f" [{', '.join(details)}]" if details else ""
    return f"{record_id} — {summary}{details_str}{prog_str}"


def generate_handover_note(events: List[Dict[str, Any]], meta: Dict[str, Any]) -> Dict[str, Any]:
    collapsed = collapse_duplicate_records(events)
    sections: Dict[str, List[Dict[str, Any]]] = {sec: [] for sec in SECTIONS}

    for ev in collapsed:
        sec = determine_section(ev)
        history = ev.get("_history", [ev])
        src_label = ev.get("source", "machine")
        rec_id = str(ev.get("record_id", "unknown"))
        sections[sec].append(
            {
                "section": sec,
                "item": format_item_text(ev, history),
                "source": f"{src_label}:{rec_id}",
                "record_id": rec_id,
                "timestamp": ev.get("timestamp"),
                "timestamp_utc": ev.get("timestamp_utc"),
                "status": ev.get("status"),
                "assignee": ev.get("assignee"),
            }
        )

    for sec in SECTIONS:
        sections[sec].sort(key=lambda x: (x.get("timestamp_utc") or "", x.get("source") or "", x.get("record_id") or ""))

    total = sum(len(v) for v in sections.values())
    b_count = len(sections["Blockers/Escalations"])
    c_count = len(sections["Completed"])
    p_count = len(sections["In Progress"])
    w_count = len(sections["Watch-List"])

    if total == 0:
        summary_text = (
            f"Shift window ({meta.get('shift_start_local', '00:00')} to {meta.get('shift_end_local', '23:59')} "
            f"{meta.get('timezone', 'UTC')}) recorded zero open tickets, abnormalities, or escalations."
        )
    else:
        summary_text = (
            f"Shift window ({meta.get('shift_start_local', '')} - {meta.get('shift_end_local', '')} "
            f"{meta.get('timezone', 'UTC')}) logged {total} grounded activity records: {c_count} completed, "
            f"{p_count} in progress, {b_count} blockers/abnormalities, {w_count} watch-list observations."
        )

    now_utc = datetime.now(timezone.utc)
    note_id = meta.get("report_id") or f"handover-{now_utc.strftime('%Y%m%d%H%M%S')}"
    return {
        "id": note_id,
        "generated_at_utc": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "meta": meta,
        "summary": summary_text,
        "sections": sections,
        "total_items": total,
    }


class _NumberedFooterCanvas(canvas.Canvas):
    """Two-pass canvas drawing consistent PS-032 footer with 'Page X of Y'."""

    def __init__(self, *args, report_id: str = "", generated_at: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states: list[dict] = []
        self._report_id = report_id
        self._generated_at = generated_at

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self._draw_footer(num_pages)
            super().showPage()
        super().save()

    def _draw_footer(self, page_count: int):
        self.saveState()
        self.setStrokeColor(colors.HexColor("#cbd5e1"))
        self.setLineWidth(0.6)
        self.line(34, 34, A4[0] - 34, 34)
        self.setFont("Helvetica", 7.2)
        self.setFillColor(colors.HexColor("#475569"))
        self.drawString(34, 22, "PS-032 Industrial Digital Twin")
        self.drawCentredString(325, 22, f"{self._report_id}  |  {self._generated_at}")
        self.drawRightString(A4[0] - 34, 22, f"Page {self._pageNumber} of {page_count}")
        self.restoreState()


def publish_pdf(note_data: Dict[str, Any], output_path: Optional[Path] = None) -> Path:
    """Render a comprehensive, A4-portrait industrial shift handover PDF."""
    if not note_data or "sections" not in note_data:
        raise ValueError("Invalid note_data: Missing required sections payload")

    note_id = str(note_data.get("id", "handover-report"))
    generated_utc = str(note_data.get("generated_at_utc", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")))
    if output_path is None:
        output_path = Path(get_settings().output_dir) / f"{note_id}.pdf"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=A4,
        rightMargin=34,
        leftMargin=34,
        topMargin=32,
        bottomMargin=44,
        title=f"PS-032 Shift Handover {note_id}",
    )

    styles = getSampleStyleSheet()
    banner_title = ParagraphStyle(
        "BannerTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=13.5,
        leading=17,
        textColor=colors.white,
        alignment=TA_LEFT,
    )
    banner_sub = ParagraphStyle(
        "BannerSub",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=12,
        textColor=colors.HexColor("#dbeafe"),
    )
    banner_meta = ParagraphStyle(
        "BannerMeta",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8,
        leading=11,
        textColor=colors.white,
        alignment=TA_RIGHT,
    )
    h2_style = ParagraphStyle(
        "SectionH2",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=13,
        textColor=colors.HexColor("#0f172a"),
        spaceBefore=8,
        spaceAfter=4,
        keepWithNext=True,
    )
    th_style = ParagraphStyle(
        "TableHead",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=colors.white,
    )
    label_style = ParagraphStyle(
        "Label",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#475569"),
    )
    cell_style = ParagraphStyle(
        "Cell",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=11.5,
        textColor=colors.HexColor("#0f172a"),
    )
    muted_style = ParagraphStyle(
        "Muted",
        parent=styles["Italic"],
        fontName="Helvetica-Oblique",
        fontSize=8.5,
        leading=11.5,
        textColor=colors.HexColor("#64748b"),
    )

    meta = note_data.get("meta", {})
    context = note_data.get("industrial_context", {}) or {}
    company_name = context.get("company_name") or "Apex Precision Manufacturing"
    region_name = context.get("region_name") or "Configured Region"
    factory_name = context.get("factory_name") or "Configured Factory"
    line_name = context.get("line_name") or "Configured Line"
    machine_name = context.get("machine_name") or meta.get("machine_label", "Industrial Machine")
    machine_id = context.get("machine_id") or "—"
    machine_code = context.get("machine_code") or "—"

    story: List[Any] = []

    # 1. HEADER BANNER
    header_tbl = Table(
        [
            [
                [
                    _p("PS-032 INDUSTRIAL SHIFT HANDOVER REPORT", banner_title),
                    _p(f"{company_name}  •  {region_name} / {factory_name} / {line_name}", banner_sub),
                    _p(f"Machine: {machine_code} — {machine_name} (ID: {machine_id})", banner_sub),
                ],
                [
                    _p(f"Report ID: {note_id}", banner_meta),
                    _p(f"Generated (UTC): {generated_utc}", banner_meta),
                    _p(f"Timezone: {meta.get('timezone', 'UTC')}", banner_meta),
                ],
            ]
        ],
        colWidths=[367.0, 160.0],
    )
    header_tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#1e3a8a")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ]
        )
    )
    story.append(header_tbl)
    story.append(Spacer(1, 10))

    # 2. MACHINE & SHIFT INFORMATION
    story.append(_p("1. MACHINE & SHIFT INFORMATION", h2_style))
    machine_info = context.get("machine_info", {}) or {}
    prod_summary = (
        f"{machine_info.get('production_completed', 0)} / {machine_info.get('production_target', 0)} units "
        f"(Rejects: {machine_info.get('reject_units', 0)}, Downtime: {machine_info.get('downtime_minutes', 0)} min, "
        f"OEE: {machine_info.get('oee_pct', '—')}%)"
    )
    telemetry_snap = (
        f"Temp: {machine_info.get('temperature_c', '—')} °C  |  "
        f"Vib: {machine_info.get('vibration_mm_s', '—')} mm/s  |  "
        f"Power: {machine_info.get('energy_kw', '—')} kW  |  "
        f"Cycle: {machine_info.get('cycle_time_sec', '—')} s  "
        f"(Source: {machine_info.get('data_source', 'simulation')})"
    )
    info_rows = [
        [
            _p("Machine Status", label_style),
            _p(machine_info.get("machine_condition", "Unknown"), cell_style),
            _p("Handover Status", label_style),
            _p(str(machine_info.get("handover_status", "PENDING")).upper(), cell_style),
        ],
        [
            _p("Outgoing Operator", label_style),
            _p(machine_info.get("outgoing_operator") or "Not assigned", cell_style),
            _p("Incoming Operator", label_style),
            _p(machine_info.get("incoming_operator") or "Pending assignment", cell_style),
        ],
        [
            _p("Shift Window", label_style),
            _p(
                f"{machine_info.get('previous_shift_name', 'Previous')} -> {machine_info.get('incoming_shift_name', 'Incoming')} "
                f"({meta.get('shift_start_local', '')}–{meta.get('shift_end_local', '')})",
                cell_style,
            ),
            _p("Shift Supervisor", label_style),
            _p(machine_info.get("supervisor_name") or "Not configured", cell_style),
        ],
        [
            _p("Production Summary", label_style),
            _p(prod_summary, cell_style),
            _p("Telemetry Snapshot", label_style),
            _p(telemetry_snap, cell_style),
        ],
    ]
    info_tbl = Table(info_rows, colWidths=[92.0, 171.5, 92.0, 171.5], repeatRows=0)
    info_tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f1f5f9")),
                ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#f1f5f9")),
                ("BACKGROUND", (1, 0), (1, -1), colors.white),
                ("BACKGROUND", (3, 0), (3, -1), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(info_tbl)
    story.append(Spacer(1, 8))

    # 3. OPERATIONAL SUMMARY (4 Grounded ShiftOps Sections)
    story.append(_p("2. OPERATIONAL SUMMARY", h2_style))
    story.append(
        _p_rich(f"<b>Overview:</b> {escape(str(note_data.get('summary', 'No summary available.')))}", cell_style)
    )
    story.append(Spacer(1, 4))

    op_rows: List[List[Any]] = [
        [_p("Category", th_style), _p("Source / ID", th_style), _p("Activity Details", th_style)]
    ]
    sec_labels = {
        "Completed": "Completed Activities",
        "In Progress": "In-Progress Activities",
        "Blockers/Escalations": "Blockers & Escalations",
        "Watch-List": "Watch-List Items",
    }
    for sec_key in SECTIONS:
        items = note_data.get("sections", {}).get(sec_key, [])
        if not items:
            op_rows.append(
                [
                    _p(sec_labels[sec_key], label_style),
                    _p("—", muted_style),
                    _p("No records available", muted_style),
                ]
            )
        else:
            for it in items:
                op_rows.append(
                    [
                        _p(sec_labels[sec_key], label_style),
                        _p(it.get("source", "—"), cell_style),
                        _p(it.get("item", "—"), cell_style),
                    ]
                )
    op_tbl = Table(op_rows, colWidths=[115.0, 105.0, 307.0], repeatRows=1, splitByRow=1)
    op_tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#334155")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(op_tbl)
    story.append(Spacer(1, 8))

    # 4. ABNORMALITIES
    story.append(_p("3. ABNORMALITIES & FAULT LOG", h2_style))
    abnormalities = context.get("abnormalities", []) or []
    abn_rows: List[List[Any]] = [
        [
            _p("Abnormality ID", th_style),
            _p("Description", th_style),
            _p("Severity", th_style),
            _p("Status", th_style),
            _p("Reported Time", th_style),
            _p("Resolution / Pending Action", th_style),
        ]
    ]
    if not abnormalities:
        abn_rows.append(
            [_p("No records available for this machine.", muted_style), "", "", "", "", ""]
        )
    else:
        for a in abnormalities:
            abn_rows.append(
                [
                    _p(a.get("code", "—"), label_style),
                    _p(f"{a.get('title', '')} — {a.get('description', '')}", cell_style),
                    _p(str(a.get("severity", "—")).upper(), cell_style),
                    _p(str(a.get("status", "—")).upper(), cell_style),
                    _p(a.get("created_at", "—"), cell_style),
                    _p(a.get("resolution_notes") or f"Assigned: {a.get('assigned_to_name') or 'Pending review'}", cell_style),
                ]
            )
    abn_tbl = Table(abn_rows, colWidths=[72.0, 145.0, 52.0, 56.0, 82.0, 120.0], repeatRows=1, splitByRow=1)
    abn_styles = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#991b1b")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fef2f2")]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]
    if not abnormalities:
        abn_styles.append(("SPAN", (0, 1), (-1, 1)))
    abn_tbl.setStyle(TableStyle(abn_styles))
    story.append(abn_tbl)
    story.append(Spacer(1, 8))

    # 5. MAINTENANCE & 5S VERIFICATION
    story.append(_p("4. MAINTENANCE & 5S VERIFICATION", h2_style))
    maint_records = context.get("maintenance_records", []) or []
    mnt_rows: List[List[Any]] = [
        [
            _p("Type", th_style),
            _p("Maintenance Summary & Parts", th_style),
            _p("Status", th_style),
            _p("Engineer", th_style),
            _p("Remarks / Notes", th_style),
        ]
    ]
    if not maint_records:
        mnt_rows.append([_p("No maintenance records available.", muted_style), "", "", "", ""])
    else:
        for m in maint_records:
            parts = f" (Parts: {m['parts_replaced']})" if m.get("parts_replaced") else ""
            mnt_rows.append(
                [
                    _p(str(m.get("maintenance_type", "—")).title(), label_style),
                    _p(f"{m.get('summary', '—')}{parts}", cell_style),
                    _p(str(m.get("status", "—")).upper(), cell_style),
                    _p(m.get("engineer_name") or "Unassigned", cell_style),
                    _p(m.get("inspection_notes") or "No remarks recorded", cell_style),
                ]
            )
    mnt_tbl = Table(mnt_rows, colWidths=[68.0, 165.0, 68.0, 96.0, 130.0], repeatRows=1, splitByRow=1)
    mnt_styles = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0369a1")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f0f9ff")]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]
    if not maint_records:
        mnt_styles.append(("SPAN", (0, 1), (-1, 1)))
    mnt_tbl.setStyle(TableStyle(mnt_styles))
    story.append(mnt_tbl)
    story.append(Spacer(1, 5))

    cleaning = context.get("cleaning_5s")
    if cleaning:
        c_rows = [
            [
                _p("Cleaning & 5S Verification", label_style),
                _p(
                    f"Area Cleaned: {'Yes' if cleaning.get('area_cleaned') else 'No'}  |  "
                    f"Lubrication Checked: {'Yes' if cleaning.get('lubrication_checked') else 'No'}  |  "
                    f"Safety Guards Verified: {'Yes' if cleaning.get('guards_verified') else 'No'}",
                    cell_style,
                ),
            ],
            [
                _p("5S Remarks & Sign-off", label_style),
                _p(
                    f"{cleaning.get('safety_observations') or 'No safety hazards noted'} "
                    f"(Logged by: {cleaning.get('logged_by_name') or 'Operator'} at {cleaning.get('logged_at', '—')})",
                    cell_style,
                ),
            ],
        ]
    else:
        c_rows = [
            [
                _p("Cleaning & 5S Verification", label_style),
                _p("No records available for this shift.", muted_style),
            ]
        ]
    c_tbl = Table(c_rows, colWidths=[130.0, 397.0])
    c_tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f1f5f9")),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(c_tbl)
    story.append(Spacer(1, 8))

    # 6. HANDOVER NOTES & INCOMING OPERATOR ACKNOWLEDGEMENT
    story.append(_p("5. HANDOVER NOTES & INCOMING OPERATOR ACKNOWLEDGEMENT", h2_style))
    notes_ctx = context.get("handover_notes", {}) or {}
    ack_ctx = context.get("acknowledgement", {}) or {}
    ack_text = (
        f"ACKNOWLEDGED by {ack_ctx.get('acknowledged_by_name')} at {ack_ctx.get('acknowledged_at')} — "
        f"Remarks: {ack_ctx.get('acknowledgement_remarks') or 'Confirmed'}"
        if ack_ctx.get("status") == "acknowledged"
        else "PENDING — Incoming operator review and digital sign-off required."
    )
    ho_rows = [
        [_p("Observations / Remarks", label_style), _p(notes_ctx.get("operator_remarks") or "No remarks recorded", cell_style)],
        [_p("Pending Work / Inspection", label_style), _p(notes_ctx.get("required_inspection") or "Standard start-of-shift inspection", cell_style)],
        [
            _p("Safety / Operating Instructions", label_style),
            _p(
                f"{notes_ctx.get('maintenance_instructions') or 'Follow standard SOP'} | "
                f"{notes_ctx.get('special_instructions') or notes_ctx.get('safety_observations') or 'No special restrictions'}",
                cell_style,
            ),
        ],
        [_p("Incoming Acknowledgement", label_style), _p(ack_text, cell_style)],
    ]
    ho_tbl = Table(ho_rows, colWidths=[142.0, 385.0], splitByRow=1)
    ho_tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f1f5f9")),
                (
                    "BACKGROUND",
                    (1, 3),
                    (1, 3),
                    colors.HexColor("#ecfdf5") if ack_ctx.get("status") == "acknowledged" else colors.HexColor("#fffbeb"),
                ),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(ho_tbl)
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#cbd5e1")))

    doc.build(
        story,
        canvasmaker=lambda *args, **kwargs: _NumberedFooterCanvas(
            *args, report_id=note_id, generated_at=generated_utc, **kwargs
        ),
    )
    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError(f"PDF export failed for {output_path}")
    return output_path
