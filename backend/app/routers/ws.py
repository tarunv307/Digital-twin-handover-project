"""WebSocket endpoint for real-time Digital Twin synchronization."""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.simulation_runner import simulation_controller
from app.services.ws_manager import ws_manager

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/digital-twin")
async def digital_twin_websocket(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        await websocket.send_json(
            {
                "type": "connected",
                "payload": {
                    "simulation": simulation_controller.status_dto().model_dump(mode="json"),
                    "clients": ws_manager.client_count,
                },
            }
        )
        while True:
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_json({"type": "pong", "payload": {}})
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
    except Exception:
        await ws_manager.disconnect(websocket)

