import React, { createContext, useContext, useEffect, useState } from "react";
import { digitalTwinApi } from "../services/api";
import { twinWsClient, type WsConnectionState } from "../services/websocket";
import type { MachineEvent, MachineState, SimulationStatus, UserAccount } from "../types/digitalTwin";

interface TwinContextValue {
  wsStatus: WsConnectionState;
  lastSyncAt: string | null;
  simulationStatus: SimulationStatus | null;
  liveStates: Record<string, MachineState>;
  liveEvents: MachineEvent[];
  overviewMode: boolean;
  setOverviewMode: (val: boolean) => void;
  structuralVersion: number;
  triggerStructuralRefresh: () => void;
  refreshSimulationStatus: () => Promise<void>;
  // Phase 2 Auth & RBAC
  currentUser: UserAccount | null;
  authModalOpen: boolean;
  setAuthModalOpen: (open: boolean) => void;
  loginUser: (email: string, password: string) => Promise<UserAccount>;
  logoutUser: () => Promise<void>;
}

const TwinContext = createContext<TwinContextValue | null>(null);

export const TwinProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [wsStatus, setWsStatus] = useState<WsConnectionState>("connecting");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [simulationStatus, setSimulationStatus] = useState<SimulationStatus | null>(null);
  const [liveStates, setLiveStates] = useState<Record<string, MachineState>>({});
  const [liveEvents, setLiveEvents] = useState<MachineEvent[]>([]);
  const [overviewMode, setOverviewMode] = useState(false);
  const [structuralVersion, setStructuralVersion] = useState(0);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const refreshSimulationStatus = async () => {
    try {
      const sim = await digitalTwinApi.getSimulationStatus();
      setSimulationStatus(sim);
    } catch {
      // backend may still be starting
    }
  };

  useEffect(() => {
    refreshSimulationStatus();
    digitalTwinApi
      .getMe()
      .then((res) => {
        if (res.authenticated && res.user) setCurrentUser(res.user);
      })
      .catch(() => {});

    const unsubStatus = twinWsClient.onStatus((s) => setWsStatus(s));
    const unsubEvent = twinWsClient.onEvent((ev) => {
      if (ev.type === "connected") {
        setSimulationStatus(ev.payload.simulation);
        setLastSyncAt(new Date().toISOString());
      } else if (ev.type === "simulation_status") {
        setSimulationStatus(ev.payload);
      } else if (ev.type === "telemetry_batch") {
        const ts = ev.payload.timestamp ?? new Date().toISOString();
        setLastSyncAt(ts);
        if (ev.payload.simulation) {
          setSimulationStatus(ev.payload.simulation);
        } else if (typeof ev.payload.tick === "number") {
          setSimulationStatus((prev) =>
            prev
              ? { ...prev, ticks_emitted: ev.payload.tick ?? prev.ticks_emitted, last_tick_at: ts }
              : prev
          );
        }
        const nextStates: Record<string, MachineState> = {};
        const newEvents: MachineEvent[] = [];
        for (const item of ev.payload.updates) {
          nextStates[item.machine_id] = item.state;
          if (item.event) newEvents.push(item.event);
        }
        setLiveStates((prev) => ({ ...prev, ...nextStates }));
        if (newEvents.length > 0) {
          setLiveEvents((prev) => [...newEvents, ...prev].slice(0, 60));
        }
      } else if (ev.type === "shift_transition") {
        setStructuralVersion((v) => v + 1);
      }
    });
    twinWsClient.connect();
    return () => {
      unsubStatus();
      unsubEvent();
      twinWsClient.disconnect();
    };
  }, []);

  const loginUser = async (email: string, password: string) => {
    const user = await digitalTwinApi.login(email, password);
    setCurrentUser(user);
    setAuthModalOpen(false);
    setStructuralVersion((v) => v + 1);
    return user;
  };

  const logoutUser = async () => {
    await digitalTwinApi.logout();
    setCurrentUser(null);
    setStructuralVersion((v) => v + 1);
  };

  return (
    <TwinContext.Provider
      value={{
        wsStatus,
        lastSyncAt,
        simulationStatus,
        liveStates,
        liveEvents,
        overviewMode,
        setOverviewMode,
        structuralVersion,
        triggerStructuralRefresh: () => setStructuralVersion((v) => v + 1),
        refreshSimulationStatus,
        currentUser,
        authModalOpen,
        setAuthModalOpen,
        loginUser,
        logoutUser,
      }}
    >
      {children}
    </TwinContext.Provider>
  );
};

export function useTwinStore() {
  const ctx = useContext(TwinContext);
  if (!ctx) throw new Error("useTwinStore must be used inside TwinProvider");
  return ctx;
}
