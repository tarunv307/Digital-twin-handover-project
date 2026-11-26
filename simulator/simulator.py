"""Standalone Python Telemetry Simulator for PS-032 Digital Twin.

Connects to the FastAPI backend over HTTP, fetches the live configured machine
hierarchy from the database, and streams realistic operational telemetry
batches into `/api/dt/telemetry/batch` (which updates DB + broadcasts via WebSocket).
"""

from __future__ import annotations

import argparse
import os
import random
import time
import httpx


class DigitalTwinSimulator:
    def __init__(self, base_url: str, interval_sec: float = 2.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.interval_sec = interval_sec
        self.client = httpx.Client(timeout=10.0)

    def fetch_machines(self) -> list[dict]:
        resp = self.client.get(f"{self.base_url}/api/dt/company")
        resp.raise_for_status()
        company = resp.json()
        machines: list[dict] = []
        for region in company.get("regions", []):
            for factory in region.get("factories", []):
                fac_resp = self.client.get(f"{self.base_url}/api/dt/factories/{factory['id']}")
                fac_resp.raise_for_status()
                fac_data = fac_resp.json()
                for line in fac_data.get("production_lines", []):
                    machines.extend(line.get("machines", []))
        return machines

    def step_once(self) -> int:
        machines = self.fetch_machines()
        items: list[dict] = []
        for m in machines:
            st = m.get("state") or {}
            status = st.get("status", "Idle")
            temp = st.get("temperature_c") or 40.0
            vib = st.get("vibration_mm_s") or 1.2
            kw = st.get("energy_kw") or 15.0

            if status == "Running":
                items.append(
                    {
                        "machine_id": m["id"],
                        "status": "Running",
                        "temperature_c": round(max(26.0, min(73.0, temp + random.uniform(-0.8, 0.9))), 2),
                        "vibration_mm_s": round(max(0.3, min(3.4, vib + random.uniform(-0.15, 0.16))), 2),
                        "cycle_time_sec": st.get("cycle_time_sec") or 22.0,
                        "energy_kw": round(max(5.0, min(52.0, kw + random.uniform(-0.7, 0.7))), 2),
                        "production_delta": 1 if random.random() < 0.75 else 0,
                        "data_source": "simulation",
                    }
                )
            elif status == "Idle":
                items.append(
                    {
                        "machine_id": m["id"],
                        "status": "Idle",
                        "temperature_c": round(max(24.0, temp + random.uniform(-0.2, 0.2)), 2),
                        "vibration_mm_s": 0.3,
                        "energy_kw": round(max(2.5, kw + random.uniform(-0.2, 0.2)), 2),
                        "data_source": "simulation",
                    }
                )
            elif status in ("Fault", "Maintenance", "Stopped"):
                items.append(
                    {
                        "machine_id": m["id"],
                        "status": status,
                        "temperature_c": round(max(24.0, temp - 0.2), 2),
                        "vibration_mm_s": vib,
                        "downtime_delta_min": round(self.interval_sec / 60.0, 3),
                        "data_source": "simulation",
                    }
                )

        if not items:
            return 0
        resp = self.client.post(f"{self.base_url}/api/dt/telemetry/batch", json={"items": items})
        resp.raise_for_status()
        return resp.json().get("accepted", 0)

    def run_forever(self) -> None:
        print(f"[Simulator] Streaming virtual telemetry to {self.base_url} every {self.interval_sec}s")
        while True:
            try:
                count = self.step_once()
                print(f"[Simulator] Dispatched telemetry for {count} machines")
            except Exception as exc:
                print(f"[Simulator] Error dispatching telemetry: {exc}")
            time.sleep(self.interval_sec)


def main() -> None:
    parser = argparse.ArgumentParser(description="PS-032 Digital Twin Python Simulator")
    parser.add_argument("--url", default=os.getenv("DT_BACKEND_URL", "http://localhost:8000"))
    parser.add_argument("--interval", type=float, default=2.0)
    parser.add_argument("--once", action="store_true", help="Send one batch and exit")
    args = parser.parse_args()

    sim = DigitalTwinSimulator(base_url=args.url, interval_sec=args.interval)
    if args.once:
        accepted = sim.step_once()
        print(f"[Simulator] Single batch accepted: {accepted} machines")
    else:
        sim.run_forever()


if __name__ == "__main__":
    main()

