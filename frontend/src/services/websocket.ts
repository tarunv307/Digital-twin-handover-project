import type { SimulationStatus, TelemetryUpdateItem } from "../types/digitalTwin";

export type WsConnectionState = "connected" | "connecting" | "disconnected";

export type TwinWsEvent =
  | { type: "connected"; payload: { simulation: SimulationStatus; clients: number } }
  | {
      type: "telemetry_batch";
      payload: {
        updates: TelemetryUpdateItem[];
        tick?: number;
        simulation?: SimulationStatus;
        timestamp?: string;
      };
    }
  | { type: "simulation_status"; payload: SimulationStatus }
  | { type: "shift_transition"; payload: Record<string, unknown> }
  | { type: "pong"; payload: Record<string, unknown> };

function resolveWsUrl(): string {
  const configured = import.meta.env.VITE_WS_URL;
  if (configured) return configured;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/digital-twin`;
}

export class TwinWebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private closedByUser = false;
  private retryDelayMs = 1500;
  private listeners = new Set<(event: TwinWsEvent) => void>();
  private statusListeners = new Set<(status: WsConnectionState) => void>();

  connect() {
    this.closedByUser = false;
    this.openSocket();
  }

  disconnect() {
    this.closedByUser = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
    this.emitStatus("disconnected");
  }

  onEvent(cb: (event: TwinWsEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onStatus(cb: (status: WsConnectionState) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private emitStatus(status: WsConnectionState) {
    this.statusListeners.forEach((cb) => cb(status));
  }

  private openSocket() {
    if (this.closedByUser) return;
    this.emitStatus("connecting");

    try {
      const ws = new WebSocket(resolveWsUrl());
      this.ws = ws;

      ws.onopen = () => {
        this.retryDelayMs = 1500;
        this.emitStatus("connected");
        if (this.pingTimer) window.clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send("ping");
          }
        }, 12000);
      };

      ws.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data) as TwinWsEvent;
          this.listeners.forEach((cb) => cb(parsed));
        } catch {
          // ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (this.pingTimer) window.clearInterval(this.pingTimer);
        this.emitStatus("disconnected");
        if (!this.closedByUser) {
          this.reconnectTimer = window.setTimeout(() => {
            this.retryDelayMs = Math.min(this.retryDelayMs * 1.5, 10000);
            this.openSocket();
          }, this.retryDelayMs);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      this.emitStatus("disconnected");
    }
  }
}

export const twinWsClient = new TwinWebSocketClient();

