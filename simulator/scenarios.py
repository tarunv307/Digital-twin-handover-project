"""Scripted demonstration scenarios for the Digital Twin Simulation Mode."""

from __future__ import annotations

import argparse
import os
import time
import httpx


def run_judge_demo(base_url: str) -> None:
    client = httpx.Client(base_url=base_url.rstrip("/"), timeout=10.0)
    print("1. Triggering simulated fault on Machine 03 (mch-chn-103)...")
    r = client.post(
        "/api/dt/simulation/fault",
        json={
            "machine_id": "mch-chn-103",
            "fault_code": "E-402",
            "fault_message": "Spindle thermal overload (>75C) during boring pass",
        },
    )
    r.raise_for_status()
    time.sleep(1.5)

    print("2. Simulating regional shift transition in South India Region...")
    r = client.post("/api/dt/simulation/shift-transition", json={"region_id": "reg-south-india"})
    r.raise_for_status()
    print("   Transition result:", r.json())
    time.sleep(1.5)

    print("3. Recovering mch-chn-103 back to Running...")
    r = client.post("/api/dt/simulation/recover", json={"machine_id": "mch-chn-103"})
    r.raise_for_status()
    print("Demo scenario complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run Digital Twin demo scenario")
    parser.add_argument("--url", default=os.getenv("DT_BACKEND_URL", "http://localhost:8000"))
    args = parser.parse_args()
    run_judge_demo(args.url)

