import React, { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { STATUS_COLORS } from "../ui/StatusBadge";
import type { MachineStatus } from "../../types/digitalTwin";

interface AndonBeaconProps {
  status: MachineStatus;
  position: [number, number, number];
}

export const AndonStackLight: React.FC<AndonBeaconProps> = ({ status, position }) => {
  const pulseRef = useRef<THREE.Mesh>(null);
  const color = STATUS_COLORS[status]?.hex ?? "#9ca3af";

  useFrame(({ clock }) => {
    if (!pulseRef.current) return;
    if (status === "Fault") {
      const s = 0.7 + 0.5 * Math.sin(clock.getElapsedTime() * 8);
      (pulseRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = s * 1.4;
    } else {
      (pulseRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.65;
    }
  });

  return (
    <group position={position}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.04, 0.5, 12]} />
        <meshStandardMaterial color="#475569" metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh ref={pulseRef} position={[0, 0.58, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 0.22, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.65} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.71, 0]}>
        <cylinderGeometry args={[0.095, 0.095, 0.04, 16]} />
        <meshStandardMaterial color="#1e293b" metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
};

interface MachineMeshProps {
  machineType: string;
  status: MachineStatus;
  selected?: boolean;
  code: string;
  name: string;
  showLabel?: boolean;
  onClick?: () => void;
  onHover?: (hovered: boolean) => void;
}

export const IndustrialMachineMesh: React.FC<MachineMeshProps> = ({
  machineType,
  status,
  selected = false,
  code,
  name,
  showLabel = true,
  onClick,
  onHover,
}) => {
  const movingPartRef = useRef<THREE.Group>(null);
  const secondaryPartRef = useRef<THREE.Group>(null);
  const statusHex = STATUS_COLORS[status]?.hex ?? "#9ca3af";

  useFrame(({ clock }) => {
    if (status !== "Running") return;
    const t = clock.getElapsedTime();
    if (movingPartRef.current) {
      if (machineType === "robotic_cell") {
        movingPartRef.current.rotation.y = Math.sin(t * 1.4) * 0.45;
      } else if (machineType === "hydraulic_press") {
        movingPartRef.current.position.y = 1.95 + Math.sin(t * 2.2) * 0.28;
      } else if (machineType === "cnc_mill" || machineType === "cnc_lathe") {
        movingPartRef.current.position.x = Math.sin(t * 2.5) * 0.35;
      } else if (machineType === "inspection_station") {
        movingPartRef.current.position.x = Math.sin(t * 1.6) * 0.55;
      } else {
        movingPartRef.current.position.y = Math.sin(t * 1.8) * 0.08;
      }
    }
    if (secondaryPartRef.current && machineType === "robotic_cell") {
      secondaryPartRef.current.rotation.z = -0.35 + Math.sin(t * 1.4 + 0.8) * 0.22;
    }
  });

  const renderMachinery = () => {
    switch (machineType) {
      case "cnc_mill":
      case "cnc_lathe":
        return (
          <group>
            {/* Heavy cast base */}
            <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
              <boxGeometry args={[3.4, 0.56, 2.5]} />
              <meshStandardMaterial color="#334155" metalness={0.55} roughness={0.45} />
            </mesh>
            {/* Main sheet-metal enclosure */}
            <mesh position={[0, 1.55, -0.05]} castShadow receiveShadow>
              <boxGeometry args={[3.2, 2.0, 2.25]} />
              <meshStandardMaterial color="#f1f5f9" metalness={0.25} roughness={0.42} />
            </mesh>
            {/* Industrial blue accent fascia */}
            <mesh position={[0, 2.48, 0]}>
              <boxGeometry args={[3.24, 0.22, 2.3]} />
              <meshStandardMaterial color="#1e3a8a" metalness={0.35} roughness={0.4} />
            </mesh>
            {/* Glazed inspection window */}
            <mesh position={[-0.2, 1.58, 1.09]}>
              <boxGeometry args={[1.65, 1.05, 0.04]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.15} opacity={0.55} transparent />
            </mesh>
            {/* Internal spindle head */}
            <group ref={movingPartRef} position={[0, 1.6, 0.3]}>
              <mesh castShadow>
                <cylinderGeometry args={[0.16, 0.12, 0.65, 16]} />
                <meshStandardMaterial color="#64748b" metalness={0.85} roughness={0.22} />
              </mesh>
            </group>
            {/* Side HMI operator console */}
            <group position={[1.25, 1.35, 1.28]} rotation={[0, -0.25, 0]}>
              <mesh castShadow>
                <boxGeometry args={[0.58, 0.72, 0.14]} />
                <meshStandardMaterial color="#1e293b" metalness={0.4} roughness={0.5} />
              </mesh>
              <mesh position={[0, 0.08, 0.08]}>
                <planeGeometry args={[0.44, 0.32]} />
                <meshStandardMaterial color="#e0f2fe" emissive="#38bdf8" emissiveIntensity={0.22} />
              </mesh>
            </group>
            <AndonStackLight status={status} position={[-1.35, 2.6, 0.9]} />
          </group>
        );

      case "robotic_cell":
        return (
          <group>
            {/* Steel safety floor plate */}
            <mesh position={[0, 0.08, 0]} receiveShadow>
              <boxGeometry args={[3.4, 0.16, 3.0]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.4} roughness={0.65} />
            </mesh>
            {/* Pedestal base */}
            <mesh position={[0, 0.52, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.55, 0.68, 0.75, 24]} />
              <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
            </mesh>
            {/* Articulated robot arm */}
            <group ref={movingPartRef} position={[0, 0.92, 0]}>
              <mesh position={[0, 0.35, 0]} castShadow>
                <cylinderGeometry args={[0.32, 0.38, 0.65, 20]} />
                <meshStandardMaterial color="#d97706" metalness={0.35} roughness={0.35} />
              </mesh>
              <group ref={secondaryPartRef} position={[0, 0.68, 0]} rotation={[0, 0, -0.35]}>
                <mesh position={[0, 0.65, 0]} castShadow>
                  <boxGeometry args={[0.32, 1.35, 0.32]} />
                  <meshStandardMaterial color="#f59e0b" metalness={0.35} roughness={0.35} />
                </mesh>
                <mesh position={[0.55, 1.25, 0]} rotation={[0, 0, Math.PI / 2.4]} castShadow>
                  <boxGeometry args={[0.24, 1.15, 0.24]} />
                  <meshStandardMaterial color="#475569" metalness={0.65} roughness={0.32} />
                </mesh>
              </group>
            </group>
            {/* Safety perimeter stanchions */}
            {[
              [-1.55, 0.55, 1.35],
              [1.55, 0.55, 1.35],
              [-1.55, 0.55, -1.35],
              [1.55, 0.55, -1.35],
            ].map((p, idx) => (
              <mesh key={idx} position={p as [number, number, number]} castShadow>
                <boxGeometry args={[0.1, 1.1, 0.1]} />
                <meshStandardMaterial color="#eab308" metalness={0.3} roughness={0.5} />
              </mesh>
            ))}
            <AndonStackLight status={status} position={[1.4, 1.1, 1.35]} />
          </group>
        );

      case "hydraulic_press":
        return (
          <group>
            <mesh position={[0, 0.32, 0]} castShadow receiveShadow>
              <boxGeometry args={[3.6, 0.64, 2.7]} />
              <meshStandardMaterial color="#334155" metalness={0.55} roughness={0.45} />
            </mesh>
            {/* Twin structural columns */}
            {[-1.35, 1.35].map((xPos, i) => (
              <mesh key={i} position={[xPos, 1.8, 0]} castShadow receiveShadow>
                <boxGeometry args={[0.55, 2.4, 1.8]} />
                <meshStandardMaterial color="#e2e8f0" metalness={0.35} roughness={0.42} />
              </mesh>
            ))}
            {/* Crown header */}
            <mesh position={[0, 3.15, 0]} castShadow>
              <boxGeometry args={[3.5, 0.62, 2.1]} />
              <meshStandardMaterial color="#1e3a8a" metalness={0.4} roughness={0.38} />
            </mesh>
            {/* Moving hydraulic slide ram */}
            <group ref={movingPartRef} position={[0, 1.95, 0]}>
              <mesh castShadow>
                <boxGeometry args={[2.0, 0.52, 1.5]} />
                <meshStandardMaterial color="#64748b" metalness={0.7} roughness={0.3} />
              </mesh>
            </group>
            <AndonStackLight status={status} position={[1.55, 3.45, 0.85]} />
          </group>
        );

      case "inspection_station":
        return (
          <group>
            {/* Precision granite metrology bed */}
            <mesh position={[0, 0.48, 0]} castShadow receiveShadow>
              <boxGeometry args={[3.1, 0.96, 2.2]} />
              <meshStandardMaterial color="#1e293b" metalness={0.2} roughness={0.25} />
            </mesh>
            {/* CMM Bridge gantry */}
            <group ref={movingPartRef} position={[0, 1.45, 0]}>
              <mesh position={[-0.9, 0, 0]} castShadow>
                <boxGeometry args={[0.16, 1.05, 1.9]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.5} roughness={0.3} />
              </mesh>
              <mesh position={[0.9, 0, 0]} castShadow>
                <boxGeometry args={[0.16, 1.05, 1.9]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.5} roughness={0.3} />
              </mesh>
              <mesh position={[0, 0.52, 0]} castShadow>
                <boxGeometry args={[2.0, 0.22, 0.35]} />
                <meshStandardMaterial color="#2563eb" metalness={0.4} roughness={0.35} />
              </mesh>
              <mesh position={[0, 0.12, 0]}>
                <cylinderGeometry args={[0.06, 0.02, 0.65, 12]} />
                <meshStandardMaterial color="#94a3b8" metalness={0.85} roughness={0.2} />
              </mesh>
            </group>
            <AndonStackLight status={status} position={[-1.35, 0.96, 0.95]} />
          </group>
        );

      default:
        // wash_station or packaging_unit
        return (
          <group>
            <mesh position={[0, 0.26, 0]} castShadow receiveShadow>
              <boxGeometry args={[3.4, 0.52, 2.2]} />
              <meshStandardMaterial color="#475569" metalness={0.5} roughness={0.45} />
            </mesh>
            <group ref={movingPartRef} position={[0, 0, 0]}>
              <mesh position={[0, 1.35, 0]} castShadow receiveShadow>
                <boxGeometry args={[2.9, 1.65, 1.85]} />
                <meshStandardMaterial
                  color={machineType === "wash_station" ? "#e2e8f0" : "#f8fafc"}
                  metalness={0.45}
                  roughness={0.32}
                />
              </mesh>
              <mesh position={[0, 2.25, 0]}>
                <boxGeometry args={[2.95, 0.18, 1.9]} />
                <meshStandardMaterial color="#0f766e" metalness={0.3} roughness={0.45} />
              </mesh>
            </group>
            <AndonStackLight status={status} position={[1.35, 2.34, 0.8]} />
          </group>
        );
    }
  };

  return (
    <group
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
        onHover?.(true);
      }}
      onPointerOut={() => {
        document.body.style.cursor = "auto";
        onHover?.(false);
      }}
    >
      {/* Floor station pad & status ring */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[2.05, 2.22, 40]} />
        <meshStandardMaterial
          color={selected ? "#1d4ed8" : statusHex}
          emissive={selected ? "#2563eb" : statusHex}
          emissiveIntensity={selected ? 0.5 : 0.18}
        />
      </mesh>

      {renderMachinery()}

      {showLabel && (
        <Html position={[0, 3.65, 0]} center distanceFactor={18} style={{ pointerEvents: "none" }}>
          <div
            className={`whitespace-nowrap rounded border px-2 py-1 text-[11px] shadow-sm transition ${
              selected
                ? "border-blue-600 bg-blue-700 text-white"
                : "border-slate-300 bg-white/95 text-slate-900"
            }`}
          >
            <div className="flex items-center gap-1.5 font-semibold">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusHex }} />
              <span className="font-mono">{code}</span>
            </div>
            <div className={`text-[10px] ${selected ? "text-blue-100" : "text-slate-500"}`}>{name}</div>
          </div>
        </Html>
      )}
    </group>
  );
};

interface FactoryBuildingProps {
  position: [number, number, number];
  size?: [number, number, number];
  title: string;
  code: string;
  oee: number;
  running: number;
  total: number;
  faults: number;
  pendingHandovers: number;
  hovered?: boolean;
  onHover?: (hovered: boolean) => void;
  onClick?: () => void;
}

export const FactoryBuildingModel: React.FC<FactoryBuildingProps> = ({
  position,
  size = [10, 4.2, 7.5],
  title,
  code,
  oee,
  running,
  total,
  faults,
  pendingHandovers,
  hovered = false,
  onHover,
  onClick,
}) => {
  const [w, h, d] = size;
  const statusColor = faults > 0 ? "#dc2626" : pendingHandovers > 0 ? "#d97706" : "#16a34a";

  return (
    <group
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
        onHover?.(true);
      }}
      onPointerOut={() => {
        document.body.style.cursor = "auto";
        onHover?.(false);
      }}
    >
      {/* Concrete foundation plinth */}
      <mesh position={[0, 0.15, 0]} receiveShadow>
        <boxGeometry args={[w + 1.4, 0.3, d + 1.4]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.85} />
      </mesh>
      {/* Main industrial hall */}
      <mesh position={[0, h / 2 + 0.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial
          color={hovered ? "#eff6ff" : "#f8fafc"}
          metalness={0.18}
          roughness={0.55}
        />
      </mesh>
      {/* Clerestory roof fascia */}
      <mesh position={[0, h + 0.45, 0]} castShadow>
        <boxGeometry args={[w + 0.3, 0.35, d + 0.3]} />
        <meshStandardMaterial color={hovered ? "#1d4ed8" : "#334155"} metalness={0.45} roughness={0.45} />
      </mesh>
      {/* Sawtooth skylight bays */}
      {[-w * 0.25, 0, w * 0.25].map((bx, i) => (
        <mesh key={i} position={[bx, h + 0.82, 0]} castShadow>
          <boxGeometry args={[w * 0.18, 0.4, d * 0.85]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.3} roughness={0.4} />
        </mesh>
      ))}
      {/* Loading bay doors */}
      {[-w * 0.22, w * 0.22].map((dx, i) => (
        <mesh key={i} position={[dx, 1.35, d / 2 + 0.04]}>
          <boxGeometry args={[1.9, 2.1, 0.08]} />
          <meshStandardMaterial color="#64748b" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
      {/* Operational status beacon */}
      <mesh position={[w / 2 - 0.6, h + 1.1, d / 2 - 0.6]}>
        <sphereGeometry args={[0.28, 16, 16]} />
        <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={0.8} />
      </mesh>

      <Html position={[0, h + 2.1, 0]} center distanceFactor={28} style={{ pointerEvents: "none" }}>
        <div
          className={`min-w-[165px] rounded-md border bg-white/95 px-2.5 py-1.5 text-left shadow-md transition ${
            hovered ? "border-blue-600 ring-2 ring-blue-200" : "border-slate-300"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-bold text-blue-700">{code}</span>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusColor }} />
          </div>
          <div className="truncate text-xs font-semibold text-slate-900">{title}</div>
          <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[10px] text-slate-600">
            <span>
              {running}/{total} Run
            </span>
            <span>OEE {oee}%</span>
          </div>
          {hovered && (
            <div className="mt-1 border-t border-slate-200 pt-1 text-[10px] font-medium text-blue-700">
              Click to enter factory →
            </div>
          )}
        </div>
      </Html>
    </group>
  );
};

