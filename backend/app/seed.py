"""Database seeding for the multi-region Industrial Digital Twin."""

from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Company,
    Factory,
    Machine,
    MachineEvent,
    MachineSpecification,
    MachineState,
    ProductionLine,
    Region,
    SensorReading,
    ShiftSchedule,
)


def seed_database_if_empty(db: Session) -> None:
    """Populate realistic enterprise Digital Twin hierarchy if database is empty."""
    existing = db.scalar(select(Company.id).limit(1))
    if existing is not None:
        return

    company = Company(
        id="comp-apex",
        name="Apex Precision Manufacturing",
        code="APEX-CORP",
        headquarters="Central Operations Command (India Network)",
        industry_sector="Automotive Powertrain & Precision Mechatronics",
        description="Multi-region precision discrete manufacturing enterprise connected to the PS-032 Digital Twin.",
        latitude=21.1458,
        longitude=79.0882,
    )
    db.add(company)

    regions = [
        Region(
            id="reg-south-india",
            company_id=company.id,
            name="South Region",
            code="REG-SOUTH",
            country="India",
            timezone="Asia/Kolkata",
            map_x=-18.0,
            map_z=6.0,
            latitude=11.6600,
            longitude=76.8000,
            description="High-volume CNC machining, EV stator assembly, and advanced components facilities.",
        ),
        Region(
            id="reg-emea-de",
            company_id=company.id,
            name="North Region",
            code="REG-NORTH",
            country="India",
            timezone="Europe/Berlin",
            map_x=2.0,
            map_z=-12.0,
            latitude=28.4595,
            longitude=77.0266,
            description="Northern industrial systems, mechatronics, and automated actuator assembly hub.",
        ),
        Region(
            id="reg-na-mw",
            company_id=company.id,
            name="West Region",
            code="REG-WEST",
            country="India",
            timezone="America/Chicago",
            map_x=20.0,
            map_z=8.0,
            latitude=18.5204,
            longitude=73.8567,
            description="Western drivetrain housing machining, motion technologies, and metrology operations.",
        ),
    ]
    db.add_all(regions)

    shift_schedules = [
        # South India (3 x 8h shifts, Night crosses midnight)
        ShiftSchedule(
            id="sh-ind-morning",
            region_id="reg-south-india",
            shift_name="Morning Shift",
            start_time="06:00",
            end_time="14:00",
            timezone="Asia/Kolkata",
            supervisor="R. Sundaram",
            assigned_operators=["K. Aravind", "M. Priya", "S. Karthik"],
            handover_deadline_minutes=20,
        ),
        ShiftSchedule(
            id="sh-ind-evening",
            region_id="reg-south-india",
            shift_name="Evening Shift",
            start_time="14:00",
            end_time="22:00",
            timezone="Asia/Kolkata",
            supervisor="V. Lakshmi",
            assigned_operators=["D. Ramesh", "N. Divya", "P. Vignesh"],
            handover_deadline_minutes=20,
        ),
        ShiftSchedule(
            id="sh-ind-night",
            region_id="reg-south-india",
            shift_name="Night Shift",
            start_time="22:00",
            end_time="06:00",
            timezone="Asia/Kolkata",
            supervisor="A. Natarajan",
            assigned_operators=["G. Balaji", "T. Anand"],
            handover_deadline_minutes=30,
        ),
        # EMEA (3 x 8h offset by 30 min)
        ShiftSchedule(
            id="sh-emea-early",
            region_id="reg-emea-de",
            shift_name="Frühschicht (Early)",
            start_time="06:30",
            end_time="14:30",
            timezone="Europe/Berlin",
            supervisor="M. Weber",
            assigned_operators=["L. Fischer", "H. Becker"],
            handover_deadline_minutes=20,
        ),
        ShiftSchedule(
            id="sh-emea-late",
            region_id="reg-emea-de",
            shift_name="Spätschicht (Late)",
            start_time="14:30",
            end_time="22:30",
            timezone="Europe/Berlin",
            supervisor="K. Hoffmann",
            assigned_operators=["J. Richter", "S. Klein"],
            handover_deadline_minutes=20,
        ),
        ShiftSchedule(
            id="sh-emea-night",
            region_id="reg-emea-de",
            shift_name="Nachtschicht (Night)",
            start_time="22:30",
            end_time="06:30",
            timezone="Europe/Berlin",
            supervisor="T. Schäfer",
            assigned_operators=["F. Neumann", "P. Wolf"],
            handover_deadline_minutes=25,
        ),
        # North America (2 x 12h shifts)
        ShiftSchedule(
            id="sh-na-day",
            region_id="reg-na-mw",
            shift_name="Day Shift (12h)",
            start_time="07:00",
            end_time="19:00",
            timezone="America/Chicago",
            supervisor="C. Miller",
            assigned_operators=["R. Brooks", "E. Dawson"],
            handover_deadline_minutes=30,
        ),
        ShiftSchedule(
            id="sh-na-night",
            region_id="reg-na-mw",
            shift_name="Night Shift (12h)",
            start_time="19:00",
            end_time="07:00",
            timezone="America/Chicago",
            supervisor="J. Alvarez",
            assigned_operators=["D. Carter", "M. Reed"],
            handover_deadline_minutes=30,
        ),
    ]
    db.add_all(shift_schedules)

    factories = [
        Factory(
            id="fac-chn-a",
            region_id="reg-south-india",
            name="Coimbatore Precision Works",
            code="FAC-CBE-A",
            facility_type="CNC & EV Assembly Plant",
            timezone="Asia/Kolkata",
            floor_width_m=92.0,
            floor_depth_m=56.0,
            site_x=-10.0,
            site_z=0.0,
            latitude=11.0168,
            longitude=76.9558,
            location_label="Coimbatore, Tamil Nadu",
            active_shift_name="Morning Shift",
        ),
        Factory(
            id="fac-hsr-b",
            region_id="reg-south-india",
            name="Mysuru Advanced Components Plant",
            code="FAC-MYS-B",
            facility_type="Precision Forming & Stamping",
            timezone="Asia/Kolkata",
            floor_width_m=76.0,
            floor_depth_m=48.0,
            site_x=12.0,
            site_z=4.0,
            latitude=12.2958,
            longitude=76.6394,
            location_label="Mysuru, Karnataka",
            active_shift_name="Morning Shift",
        ),
        Factory(
            id="fac-str-c",
            region_id="reg-emea-de",
            name="Gurugram Industrial Systems",
            code="FAC-GGN-C",
            facility_type="Robotic Actuator Assembly",
            timezone="Europe/Berlin",
            floor_width_m=80.0,
            floor_depth_m=50.0,
            site_x=0.0,
            site_z=0.0,
            latitude=28.4595,
            longitude=77.0266,
            location_label="Gurugram, Haryana",
            active_shift_name="Nachtschicht (Night)",
        ),
        Factory(
            id="fac-dtw-d",
            region_id="reg-na-mw",
            name="Pune Motion Technologies",
            code="FAC-PNQ-D",
            facility_type="Drivetrain & Motion Machining",
            timezone="America/Chicago",
            floor_width_m=82.0,
            floor_depth_m=50.0,
            site_x=0.0,
            site_z=0.0,
            latitude=18.5204,
            longitude=73.8567,
            location_label="Pune, Maharashtra",
            active_shift_name="Night Shift (12h)",
        ),
    ]
    db.add_all(factories)

    lines = [
        ProductionLine(
            id="line-chn-01",
            factory_id="fac-chn-a",
            name="Production Line 01 — Powertrain CNC",
            code="CHN-L01",
            process_type="5-Axis Machining & Metrology",
            line_index=1,
            floor_offset_z=-10.0,
            target_oee=86.0,
        ),
        ProductionLine(
            id="line-chn-02",
            factory_id="fac-chn-a",
            name="Production Line 02 — EV Stator Cell",
            code="CHN-L02",
            process_type="Winding, Impregnation & Test",
            line_index=2,
            floor_offset_z=10.0,
            target_oee=88.0,
        ),
        ProductionLine(
            id="line-hsr-01",
            factory_id="fac-hsr-b",
            name="Production Line 01 — Transfer Press",
            code="HSR-L01",
            process_type="Progressive Stamping",
            line_index=1,
            floor_offset_z=0.0,
            target_oee=82.0,
        ),
        ProductionLine(
            id="line-str-01",
            factory_id="fac-str-c",
            name="Production Line 01 — Actuator Assembly",
            code="STR-L01",
            process_type="Automated Precision Assembly",
            line_index=1,
            floor_offset_z=0.0,
            target_oee=90.0,
        ),
        ProductionLine(
            id="line-dtw-01",
            factory_id="fac-dtw-d",
            name="Production Line 01 — Housing Transfer",
            code="DTW-L01",
            process_type="High-Speed Bore & Wash",
            line_index=1,
            floor_offset_z=0.0,
            target_oee=84.0,
        ),
    ]
    db.add_all(lines)

    # Machine blueprints: (id, line_id, name, code, type, seq, status, operator, prod, target, temp, vib, cycle, kw, oee, handover, partial_specs)
    machine_defs = [
        # CHN-L01 (6 sequential stations along X axis, spaced 11m apart)
        ("mch-chn-101", "line-chn-01", "Machine 01 — Raw Billet Loader", "MCH-101", "robotic_cell", 1, "Running", "K. Aravind", 142, 160, 41.2, 1.1, 22.4, 14.8, 89.4, "complete", False),
        ("mch-chn-102", "line-chn-01", "Machine 02 — 5-Axis CNC Mill", "MCH-102", "cnc_mill", 2, "Running", "K. Aravind", 140, 160, 56.8, 1.8, 28.5, 32.6, 87.2, "complete", False),
        ("mch-chn-103", "line-chn-01", "Machine 03 — Precision Bore Center", "MCH-103", "cnc_lathe", 3, "Running", "M. Priya", 138, 160, 59.1, 2.1, 27.0, 29.4, 86.1, "pending", False),
        ("mch-chn-104", "line-chn-01", "Machine 04 — Laser CMM Inspection", "MCH-104", "inspection_station", 4, "Idle", "M. Priya", 135, 160, 31.4, 0.4, 16.2, 6.2, 76.5, "complete", False),
        ("mch-chn-105", "line-chn-01", "Machine 05 — Ultrasonic Parts Wash", "MCH-105", "wash_station", 5, "Running", "S. Karthik", 134, 160, 64.5, 1.4, 19.8, 18.5, 84.8, "complete", True),
        ("mch-chn-106", "line-chn-01", "Machine 06 — Automated Palletizer", "MCH-106", "packaging_unit", 6, "Running", "S. Karthik", 132, 160, 38.0, 0.9, 15.0, 11.2, 88.0, "complete", False),
        # CHN-L02 (4 sequential stations)
        ("mch-chn-201", "line-chn-02", "Stator Core Press 01", "MCH-201", "hydraulic_press", 1, "Running", "D. Ramesh", 98, 120, 48.2, 2.3, 24.0, 27.0, 84.5, "complete", False),
        ("mch-chn-202", "line-chn-02", "Copper Hairpin Inserter", "MCH-202", "robotic_cell", 2, "Maintenance", "N. Divya", 74, 120, 34.0, 0.3, 0.0, 4.1, 46.2, "pending", False),
        ("mch-chn-203", "line-chn-02", "Laser Weld Cell 03", "MCH-203", "cnc_mill", 3, "Running", "N. Divya", 94, 120, 52.6, 1.3, 21.5, 24.8, 85.1, "complete", False),
        ("mch-chn-204", "line-chn-02", "Hi-Pot Dielectric Tester", "MCH-204", "inspection_station", 4, "Running", "P. Vignesh", 92, 120, 29.8, 0.2, 14.5, 5.4, 88.9, "complete", False),
        # HSR-L01 (4 stations)
        ("mch-hsr-301", "line-hsr-01", "Coil Decoiler & Feeder", "MCH-301", "packaging_unit", 1, "Running", "G. Balaji", 210, 240, 36.4, 1.5, 11.2, 12.0, 87.5, "complete", False),
        ("mch-hsr-302", "line-hsr-01", "800T Hydraulic Transfer Press", "MCH-302", "hydraulic_press", 2, "Running", "G. Balaji", 208, 240, 61.2, 3.1, 12.0, 46.5, 85.0, "complete", False),
        ("mch-hsr-303", "line-hsr-01", "Trim & Pierce Die Cell", "MCH-303", "hydraulic_press", 3, "Fault", "T. Anand", 162, 240, 79.4, 6.8, 0.0, 8.2, 41.0, "pending", False),
        ("mch-hsr-304", "line-hsr-01", "Optical Flatness Scanner", "MCH-304", "inspection_station", 4, "Idle", "T. Anand", 160, 240, 28.9, 0.3, 10.5, 4.8, 72.1, "complete", False),
        # STR-L01 (5 stations)
        ("mch-str-401", "line-str-01", "Housing Feed Robot", "MCH-401", "robotic_cell", 1, "Running", "L. Fischer", 118, 130, 37.5, 0.8, 18.0, 11.4, 91.2, "complete", False),
        ("mch-str-402", "line-str-01", "Gearbox Micro-Mill", "MCH-402", "cnc_mill", 2, "Running", "L. Fischer", 117, 130, 51.0, 1.2, 20.4, 22.1, 90.4, "complete", False),
        ("mch-str-403", "line-str-01", "Servo Torque Assembly", "MCH-403", "robotic_cell", 3, "Running", "H. Becker", 115, 130, 40.2, 0.9, 19.1, 13.7, 89.6, "complete", False),
        ("mch-str-404", "line-str-01", "NVH Acoustic Test Booth", "MCH-404", "inspection_station", 4, "Running", "H. Becker", 114, 130, 26.5, 0.2, 16.0, 6.0, 92.0, "complete", False),
        ("mch-str-405", "line-str-01", "Traceability Laser Etcher", "MCH-405", "packaging_unit", 5, "Stopped", "J. Richter", 110, 130, 25.0, 0.1, 0.0, 1.2, 58.0, "pending", True),
        # DTW-L01 (4 stations)
        ("mch-dtw-501", "line-dtw-01", "Castings Gantry Loader", "MCH-501", "robotic_cell", 1, "Running", "R. Brooks", 88, 110, 39.5, 1.1, 25.0, 15.2, 83.4, "complete", False),
        ("mch-dtw-502", "line-dtw-01", "Dual-Spindle Rougher", "MCH-502", "cnc_mill", 2, "Running", "R. Brooks", 86, 110, 58.4, 2.0, 31.0, 34.0, 82.1, "complete", False),
        ("mch-dtw-503", "line-dtw-01", "Finish Line-Bore Mill", "MCH-503", "cnc_lathe", 3, "Running", "E. Dawson", 85, 110, 55.2, 1.7, 29.5, 28.8, 84.0, "complete", False),
        ("mch-dtw-504", "line-dtw-01", "High-Pressure Deburr", "MCH-504", "wash_station", 4, "Running", "E. Dawson", 84, 110, 50.1, 1.5, 20.0, 19.4, 85.5, "complete", False),
    ]

    specs_catalog = {
        "robotic_cell": ("FANUC Robotics", "R-2000iC/210F", "6-Axis Articulated Cell", 180.0, "OPC-UA / PROFINET", {"max_temp_c": 65.0, "max_vibration_mm_s": 3.5}),
        "cnc_mill": ("DMG MORI", "DMU 75 monoBLOCK", "5-Axis CNC Machining Center", 140.0, "MTConnect / OPC-UA", {"max_temp_c": 72.0, "max_vibration_mm_s": 4.0}),
        "cnc_lathe": ("Mazak", "INTEGREX i-200H", "Multi-Tasking Turning Center", 150.0, "MTConnect / OPC-UA", {"max_temp_c": 70.0, "max_vibration_mm_s": 3.8}),
        "inspection_station": ("ZEISS", "CONTURA 10/16/6", "Inline Optical & CMM Metrology", 200.0, "OPC-UA", {"max_temp_c": 40.0, "max_vibration_mm_s": 1.2}),
        "wash_station": ("Dürr Ecoclean", "EcoCwave 400", "Ultrasonic Aqueous Cleaning", 220.0, "Modbus TCP / OPC-UA", {"max_temp_c": 78.0, "max_vibration_mm_s": 3.0}),
        "packaging_unit": ("KUKA", "KR QUANTEC PA", "End-of-Line Automated Cell", 260.0, "PROFINET", {"max_temp_c": 55.0, "max_vibration_mm_s": 2.8}),
        "hydraulic_press": ("Schuler", "MSD-800 Servo", "Servo-Hydraulic Transfer Press", 240.0, "OPC-UA / EtherCAT", {"max_temp_c": 75.0, "max_vibration_mm_s": 5.2}),
    }

    now = datetime.now(timezone.utc)
    line_counts: dict[str, int] = {}
    for m in machine_defs:
        line_counts[m[1]] = line_counts.get(m[1], 0) + 1

    for (
        m_id,
        line_id,
        name,
        code,
        m_type,
        seq,
        status,
        operator,
        prod,
        target,
        temp,
        vib,
        cycle,
        kw,
        oee,
        handover,
        partial_specs,
    ) in machine_defs:
        total_in_line = line_counts[line_id]
        spacing = 11.0
        pos_x = (seq - 1 - (total_in_line - 1) / 2.0) * spacing
        machine = Machine(
            id=m_id,
            line_id=line_id,
            name=name,
            code=code,
            machine_type=m_type,
            sequence_order=seq,
            pos_x=pos_x,
            pos_y=0.0,
            pos_z=0.0,
            rotation_y=0.0,
            qr_token=f"QR-{code}",
        )
        db.add(machine)

        mfg, model, cat, cap, proto, limits = specs_catalog[m_type]
        spec = MachineSpecification(
            machine_id=m_id,
            manufacturer=mfg,
            model=model,
            serial_number=None if partial_specs else f"SN-{code}-2024",
            category=cat,
            installation_date=None if partial_specs else "2024-03-18",
            rated_capacity_units_hr=cap,
            operating_parameters={"coolant_bar": 18.5, "spindle_rpm_nominal": 4200} if m_type in ("cnc_mill", "cnc_lathe") else {"nominal_pressure_bar": 6.2},
            supported_modes=["Auto", "Setup", "Dry-Run", "Maintenance"],
            connected_sensors=[
                {"id": f"{code}-TEMP-01", "type": "Thermal RTD", "unit": "°C"},
                {"id": f"{code}-VIB-01", "type": "Tri-axial Accelerometer", "unit": "mm/s"},
                {"id": f"{code}-PWR-01", "type": "CT Power Meter", "unit": "kW"},
            ],
            communication_protocol=proto,
            operating_limits=limits,
            maintenance_interval_hours=500,
            last_maintenance_date=None if partial_specs else "2026-10-12",
            responsible_department="Powertrain & Automation Engineering",
        )
        db.add(spec)

        state = MachineState(
            machine_id=m_id,
            status=status,
            data_source="simulation",
            sensor_connectivity="connected",
            assigned_operator=operator,
            production_count=prod,
            production_target=target,
            temperature_c=temp,
            vibration_mm_s=vib,
            cycle_time_sec=cycle,
            energy_kw=kw,
            downtime_min=22.0 if status == "Fault" else (14.0 if status == "Maintenance" else 2.5),
            availability_pct=92.0 if status == "Running" else 68.0,
            performance_pct=round((prod / target) * 100.0, 1),
            quality_pct=99.2,
            oee_pct=oee,
            active_fault_code="E-309" if status == "Fault" else None,
            active_fault_message="Hydraulic cushion pressure drop & vibration threshold exceeded" if status == "Fault" else None,
            handover_status=handover,
            last_sync_at=now,
        )
        db.add(state)

        # Seed short reading history for live chart continuity
        for i in range(8):
            ts = now - timedelta(seconds=(8 - i) * 15)
            db.add(
                SensorReading(
                    machine_id=m_id,
                    timestamp=ts,
                    status=status,
                    temperature_c=round(temp + (i - 4) * 0.25, 2),
                    vibration_mm_s=round(max(0.1, vib + (i % 3 - 1) * 0.08), 2),
                    cycle_time_sec=cycle,
                    energy_kw=kw,
                    production_count=max(0, prod - (8 - i)),
                    data_source="simulation",
                )
            )

    # Seed initial events
    db.add_all(
        [
            MachineEvent(
                machine_id="mch-hsr-303",
                factory_id="fac-hsr-b",
                region_id="reg-south-india",
                line_id="line-hsr-01",
                shift_name="Morning Shift",
                event_type="fault_detected",
                severity="critical",
                previous_status="Running",
                new_status="Fault",
                message="E-309: Hydraulic cushion pressure drop & vibration threshold exceeded",
                data_source="simulation",
                timestamp=now - timedelta(minutes=6),
            ),
            MachineEvent(
                machine_id="mch-chn-202",
                factory_id="fac-chn-a",
                region_id="reg-south-india",
                line_id="line-chn-02",
                shift_name="Morning Shift",
                event_type="maintenance_mode",
                severity="warning",
                previous_status="Running",
                new_status="Maintenance",
                message="Scheduled coil guide alignment & preventive inspection",
                data_source="simulation",
                timestamp=now - timedelta(minutes=18),
            ),
            MachineEvent(
                machine_id="mch-chn-103",
                factory_id="fac-chn-a",
                region_id="reg-south-india",
                line_id="line-chn-01",
                shift_name="Morning Shift",
                event_type="handover_pending",
                severity="warning",
                previous_status="Running",
                new_status="Running",
                message="Shift handover awaiting incoming operator sign-off (Phase 2 workflow hook)",
                data_source="simulation",
                timestamp=now - timedelta(minutes=12),
            ),
        ]
    )

    db.commit()


def ensure_hierarchy_display_names(db: Session) -> None:
    """Safely update existing company, region, and factory display names & coordinates without duplicating records."""
    changed = False
    company = db.get(Company, "comp-apex")
    if company and (
        company.name != "Apex Precision Manufacturing"
        or company.latitude != 21.1458
        or company.longitude != 79.0882
    ):
        company.name = "Apex Precision Manufacturing"
        company.headquarters = "Central Operations Command (India Network)"
        company.latitude = 21.1458
        company.longitude = 79.0882
        changed = True

    region_updates = {
        "reg-south-india": (
            "South Region",
            "REG-SOUTH",
            "India",
            11.6600,
            76.8000,
            "High-volume CNC machining, EV stator assembly, and advanced components facilities.",
        ),
        "reg-emea-de": (
            "North Region",
            "REG-NORTH",
            "India",
            28.4595,
            77.0266,
            "Northern industrial systems, mechatronics, and automated actuator assembly hub.",
        ),
        "reg-na-mw": (
            "West Region",
            "REG-WEST",
            "India",
            18.5204,
            73.8567,
            "Western drivetrain housing machining, motion technologies, and metrology operations.",
        ),
    }
    for reg_id, (name, code, country, lat, lng, desc) in region_updates.items():
        reg = db.get(Region, reg_id)
        if reg and (
            reg.name != name
            or reg.code != code
            or reg.description != desc
            or reg.latitude != lat
            or reg.longitude != lng
        ):
            reg.name = name
            reg.code = code
            reg.country = country
            reg.latitude = lat
            reg.longitude = lng
            reg.description = desc
            changed = True

    factory_updates = {
        "fac-chn-a": ("Coimbatore Precision Works", "FAC-CBE-A", 11.0168, 76.9558, "Coimbatore, Tamil Nadu"),
        "fac-hsr-b": ("Mysuru Advanced Components Plant", "FAC-MYS-B", 12.2958, 76.6394, "Mysuru, Karnataka"),
        "fac-str-c": ("Gurugram Industrial Systems", "FAC-GGN-C", 28.4595, 77.0266, "Gurugram, Haryana"),
        "fac-dtw-d": ("Pune Motion Technologies", "FAC-PNQ-D", 18.5204, 73.8567, "Pune, Maharashtra"),
    }
    for fac_id, (name, code, lat, lng, loc_label) in factory_updates.items():
        fac = db.get(Factory, fac_id)
        if fac and (
            fac.name != name
            or fac.code != code
            or fac.latitude != lat
            or fac.longitude != lng
            or fac.location_label != loc_label
        ):
            fac.name = name
            fac.code = code
            fac.latitude = lat
            fac.longitude = lng
            fac.location_label = loc_label
            changed = True

    if changed:
        db.commit()

