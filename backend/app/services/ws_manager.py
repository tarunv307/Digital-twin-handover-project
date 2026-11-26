"""WebSocket connection manager for live Digital Twin state broadcasts."""

import asyncio
import json
from typing import Any
from fastapi import WebSocket


class WebSocketManager:
    """Manages active WebSocket clients and broadcasts structured Twin events."""

    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)

    async def broadcast(self, event_type: str, payload: dict[str, Any]) -> None:
        message = json.dumps({"type": event_type, "payload": payload}, default=str)
        async with self._lock:
            targets = list(self._connections)

        stale: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_text(message)
            except Exception:
                stale.append(ws)

        if stale:
            async with self._lock:
                for ws in stale:
                    self._connections.discard(ws)

    @property
    def client_count(self) -> int:
        return len(self._connections)


ws_manager = WebSocketManager()

