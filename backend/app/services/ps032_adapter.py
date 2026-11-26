"""Phase 2 PS-032 Integration Adapter connecting Digital Twin views to real DB handover records."""

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.models_ps032 import Abnormality, HandoverRecord
from app.schemas import HandoverHookDTO


class PS032IntegrationAdapter:
    """Connects Digital Twin MachineDetail views to live PS-032 handover & abnormality data."""

    def get_machine_handover_hook(
        self,
        machine_id: str,
        handover_status: str,
        previous_shift_name: str | None,
        current_shift_name: str | None,
        db: Session | None = None,
    ) -> HandoverHookDTO:
        if db is None:
            return HandoverHookDTO(
                integration_phase="phase2_active",
                handover_status=handover_status,
                previous_shift_name=previous_shift_name,
                current_shift_name=current_shift_name,
                message="PS-032 handover integration active.",
            )

        latest_handover = db.scalar(
            select(HandoverRecord)
            .where(HandoverRecord.machine_id == machine_id)
            .order_by(desc(HandoverRecord.created_at))
            .limit(1)
        )
        open_abnormalities = list(
            db.scalars(
                select(Abnormality).where(
                    Abnormality.machine_id == machine_id,
                    Abnormality.status != "resolved",
                )
            )
        )

        if latest_handover:
            msg = (
                f"Handover {latest_handover.id} is {latest_handover.status.upper()} "
                f"({latest_handover.previous_shift_name} -> {latest_handover.incoming_shift_name}); "
                f"{len(open_abnormalities)} unresolved abnormalities."
            )
            return HandoverHookDTO(
                integration_phase="phase2_active",
                handover_status=latest_handover.status,
                previous_shift_name=latest_handover.previous_shift_name,
                current_shift_name=latest_handover.incoming_shift_name,
                message=msg,
            )

        return HandoverHookDTO(
            integration_phase="phase2_active",
            handover_status=handover_status,
            previous_shift_name=previous_shift_name,
            current_shift_name=current_shift_name,
            message=f"Ready for shift handover generation; {len(open_abnormalities)} open abnormalities.",
        )


ps032_adapter = PS032IntegrationAdapter()
