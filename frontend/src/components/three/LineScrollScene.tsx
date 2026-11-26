import React from "react";
import { Grid, Html } from "@react-three/drei";
import { CameraRig } from "./CameraRig";
import { IndustrialMachineMesh } from "./IndustrialAssets";
import { useTwinStore } from "../../store/twinStore";
import type { MachineSummary } from "../../types/digitalTwin";

interface LineScrollSceneProps {
  machines: MachineSummary[];
  /** Continuous scroll index from 0 to machines.length - 1 */
  scrollProgress: number;
  activeMachineId: string | null;
  inspectionMode?: boolean;
  onSelectMachine: (machineId: string) => void;
}

export const LineScrollScene: React.FC<LineScrollSceneProps> = ({
  machines,
  scrollProgress,
  activeMachineId,
  inspectionMode = false,
  onSelectMachine,
}) => {
  const { liveStates } = useTwinStore();

  // Compute smooth interpolated X position along the configured machine sequence
  let targetX = 0;
  if (machines.length > 0) {
    const clamped = Math.max(0, Math.min(machines.length - 1, scrollProgress));
    const lowIdx = Math.floor(clamped);
    const highIdx = Math.min(machines.length - 1, lowIdx + 1);
    const frac = clamped - lowIdx;
    const x0 = machines[lowIdx]?.pos_x ?? 0;
    const x1 = machines[highIdx]?.pos_x ?? x0;
    targetX = x0 + (x1 - x0) * frac;
  }

  // Offset camera target slightly to the right so machine sits cleanly in left-center, leaving right side clear for HUD
  const camPos: [number, number, number] = inspectionMode
    ? [targetX + 2.4, 3.8, 7.6]
    : [targetX + 1.4, 4.1, 9.8];
  const camTarget: [number, number, number] = inspectionMode
    ? [targetX + 1.2, 1.35, 0]
    : [targetX + 1.1, 1.4, 0];

  const span = Math.max(26, machines.length * 12);

  return (
    <>
      <CameraRig
        position={camPos}
        target={camTarget}
        enableOrbit={inspectionMode}
        smoothSpeed={5.5}
        minDistance={4.2}
        maxDistance={26}
      />

      {/* Production corridor epoxy floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[span + 24, 30]} />
        <meshStandardMaterial color="#e5e9ef" roughness={0.78} />
      </mesh>
      <Grid
        position={[0, 0.01, 0]}
        args={[span + 20, 26]}
        cellSize={1.5}
        cellThickness={0.45}
        cellColor="#cbd5e1"
        sectionSize={6}
        sectionThickness={0.9}
        sectionColor="#94a3b8"
        fadeDistance={75}
      />

      {/* Line conveyor spine linking machines in sequence */}
      <mesh position={[0, 0.36, -2.1]} castShadow receiveShadow>
        <boxGeometry args={[span - 2, 0.3, 0.9]} />
        <meshStandardMaterial color="#64748b" metalness={0.55} roughness={0.35} />
      </mesh>
      {/* Safety walkway border */}
      <mesh position={[0, 0.015, 2.9]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[span, 0.18]} />
        <meshStandardMaterial color="#eab308" />
      </mesh>

      {machines.map((m) => {
        const effectiveState = liveStates[m.id] ?? m.state;
        const isSelected = m.id === activeMachineId;
        return (
          <group key={m.id} position={[m.pos_x, m.pos_y, m.pos_z]} rotation={[0, m.rotation_y, 0]}>
            <IndustrialMachineMesh
              machineType={m.machine_type}
              status={effectiveState?.status ?? "Unknown"}
              selected={isSelected}
              code={m.code}
              name={m.name}
              showLabel={!inspectionMode || !isSelected}
              onClick={() => onSelectMachine(m.id)}
            />
            {/* Station sequence floor marker */}
            <Html position={[0, 0.05, 2.55]} center distanceFactor={14} style={{ pointerEvents: "none" }}>
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                  isSelected ? "bg-blue-700 text-white" : "bg-slate-200 text-slate-700"
                }`}
              >
                ST-{String(m.sequence_order).padStart(2, "0")}
              </span>
            </Html>
          </group>
        );
      })}
    </>
  );
};

