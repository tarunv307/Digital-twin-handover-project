import React, { useEffect, useMemo, useRef } from "react";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { IndustrialMachineMesh } from "./IndustrialAssets";
import { getIndustrialTextures } from "./IndustrialTextures";
import { useTwinStore } from "../../store/twinStore";
import type { FactoryDetail } from "../../types/digitalTwin";

interface FactoryInteriorHallProps {
  factory: FactoryDetail;
  selectedMachineId: string | null;
  onSelectMachine: (machineId: string) => void;
  onEnterLine: (lineId: string) => void;
}

export const FactoryInteriorHall: React.FC<FactoryInteriorHallProps> = ({
  factory,
  selectedMachineId,
  onSelectMachine,
  onEnterLine,
}) => {
  const { liveStates } = useTwinStore();
  const textures = useMemo(() => getIndustrialTextures(), []);

  const w = Math.max(82, factory.floor_width_m || 90);
  const d = Math.max(52, factory.floor_depth_m || 56);
  const ceilingY = 12.2;

  const trussMeshRef = useRef<THREE.InstancedMesh>(null);
  const columnMeshRef = useRef<THREE.InstancedMesh>(null);
  const lightMeshRef = useRef<THREE.InstancedMesh>(null);

  // Repeating Warren roof truss geometry members spanning full hall width
  const trussMembers = useMemo(() => {
    const members: Array<{
      pos: [number, number, number];
      scale: [number, number, number];
      rotZ?: number;
    }> = [];
    const spanCount = 10;
    const stepZ = (d - 4) / spanCount;
    const webSegments = 12;
    const segW = (w - 4) / webSegments;

    for (let s = 0; s <= spanCount; s += 1) {
      const z = -d / 2 + 2 + s * stepZ;
      // Bottom & top chords
      members.push({ pos: [0, ceilingY - 1.5, z], scale: [w - 2, 0.22, 0.22] });
      members.push({ pos: [0, ceilingY, z], scale: [w - 2, 0.24, 0.24] });

      // Diagonal truss web members
      for (let seg = 0; seg < webSegments; seg += 1) {
        const cx = -w / 2 + 2 + (seg + 0.5) * segW;
        const diagLen = Math.hypot(segW * 0.9, 1.5);
        const angle = (seg % 2 === 0 ? 1 : -1) * Math.atan2(segW * 0.9, 1.5);
        members.push({
          pos: [cx, ceilingY - 0.75, z],
          scale: [0.1, diagLen, 0.1],
          rotZ: angle,
        });
      }
    }

    // Longitudinal purlins running length of roof ceiling
    [-w * 0.36, -w * 0.18, 0, w * 0.18, w * 0.36].forEach((px) => {
      members.push({ pos: [px, ceilingY + 0.2, 0], scale: [0.18, 0.18, d - 2] });
    });

    return members;
  }, [w, d, ceilingY]);

  // Structural H-Columns along both perimeter sidewalls and end walls
  const columnTransforms = useMemo(() => {
    const cols: Array<{ pos: [number, number, number]; scale: [number, number, number] }> = [];
    const bayZ = 9;
    for (let i = 0; i <= bayZ; i += 1) {
      const cz = -d / 2 + 1.5 + ((d - 3) / bayZ) * i;
      cols.push({ pos: [-w / 2 + 0.65, ceilingY / 2, cz], scale: [0.68, ceilingY, 0.68] });
      cols.push({ pos: [w / 2 - 0.65, ceilingY / 2, cz], scale: [0.68, ceilingY, 0.68] });
    }
    return cols;
  }, [w, d, ceilingY]);

  // High-Bay LED Strip Fixtures (3 rows x 8 fixtures matching Reference Image 2)
  const ledFixtures = useMemo(() => {
    const lights: Array<[number, number, number]> = [];
    const rowsX = [-w * 0.28, 0, w * 0.28];
    const countZ = 7;
    for (let i = 0; i < countZ; i += 1) {
      const lz = -d / 2 + 6 + ((d - 12) / (countZ - 1)) * i;
      rowsX.forEach((lx) => lights.push([lx, ceilingY - 1.65, lz]));
    }
    return lights;
  }, [w, d, ceilingY]);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    if (trussMeshRef.current) {
      trussMembers.forEach((m, idx) => {
        dummy.position.set(...m.pos);
        dummy.rotation.set(0, 0, m.rotZ ?? 0);
        dummy.scale.set(...m.scale);
        dummy.updateMatrix();
        trussMeshRef.current!.setMatrixAt(idx, dummy.matrix);
      });
      trussMeshRef.current.instanceMatrix.needsUpdate = true;
    }
    if (columnMeshRef.current) {
      columnTransforms.forEach((c, idx) => {
        dummy.position.set(...c.pos);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(...c.scale);
        dummy.updateMatrix();
        columnMeshRef.current!.setMatrixAt(idx, dummy.matrix);
      });
      columnMeshRef.current.instanceMatrix.needsUpdate = true;
    }
    if (lightMeshRef.current) {
      ledFixtures.forEach(([x, y, z], idx) => {
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        lightMeshRef.current!.setMatrixAt(idx, dummy.matrix);
      });
      lightMeshRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [trussMembers, columnTransforms, ledFixtures]);

  return (
    <group>
      {/* Crisp Interior High-Bay Illumination */}
      <ambientLight intensity={0.45} color="#f8fafc" />
      <pointLight position={[-w * 0.2, ceilingY - 2, -d * 0.2]} intensity={32} distance={75} decay={1.5} color="#f8fafc" />
      <pointLight position={[w * 0.2, ceilingY - 2, d * 0.2]} intensity={32} distance={75} decay={1.5} color="#f0f9ff" />

      {/* Polished Concrete Shop Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial
          map={textures.concreteMap}
          roughnessMap={textures.concreteRoughnessMap}
          color="#e4ebf3"
          roughness={0.34}
          metalness={0.12}
        />
      </mesh>

      {/* Main Pedestrian / AGV Safety Aisle Walkway Spine */}
      <mesh position={[0, 0.012, d * 0.5 - 5.2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w - 6, 3.2]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.62} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0.015, d * 0.5 - 3.62]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w - 6, 0.14]} />
        <meshStandardMaterial color="#eab308" roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.015, d * 0.5 - 6.78]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w - 6, 0.14]} />
        <meshStandardMaterial color="#eab308" roughness={0.45} />
      </mesh>

      {/* Maintenance & Calibration Zone Pad */}
      <group position={[-w / 2 + 8.5, 0.02, d / 2 - 5.5]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[12, 7.5]} />
          <meshStandardMaterial color="#dbeafe" roughness={0.55} />
        </mesh>
        <Html position={[0, 1.5, 0]} center distanceFactor={30} style={{ pointerEvents: "none" }}>
          <div className="rounded border border-blue-200 bg-white/95 px-2.5 py-1 text-[10px] font-bold text-[#14213D] shadow-sm">
            MAINTENANCE &amp; CALIBRATION BAY
          </div>
        </Html>
      </group>

      {/* Perimeter Insulated Cladding Walls + Clerestory Daylight Windows */}
      {/* Back Wall (-Z) */}
      <mesh position={[0, ceilingY / 2, -d / 2]} receiveShadow>
        <boxGeometry args={[w, ceilingY, 0.35]} />
        <meshStandardMaterial map={textures.claddingMap} color="#edf2f7" roughness={0.62} metalness={0.18} />
      </mesh>
      <mesh position={[0, 6.2, -d / 2 + 0.22]}>
        <boxGeometry args={[w - 6, 2.2, 0.05]} />
        <meshStandardMaterial color="#e0f2fe" emissive="#bae6fd" emissiveIntensity={0.45} roughness={0.2} />
      </mesh>

      {/* Left & Right Sidewalls (-X / +X) */}
      <mesh position={[-w / 2, ceilingY / 2, 0]} receiveShadow>
        <boxGeometry args={[0.35, ceilingY, d]} />
        <meshStandardMaterial map={textures.claddingMap} color="#e2e8f0" roughness={0.62} metalness={0.2} />
      </mesh>
      <mesh position={[w / 2, ceilingY / 2, 0]} receiveShadow>
        <boxGeometry args={[0.35, ceilingY, d]} />
        <meshStandardMaterial map={textures.claddingMap} color="#e2e8f0" roughness={0.62} metalness={0.2} />
      </mesh>
      {/* Daylight Ribbon Windows Along Sidewalls */}
      <mesh position={[-w / 2 + 0.22, 6.2, 0]}>
        <boxGeometry args={[0.05, 2.1, d - 6]} />
        <meshStandardMaterial color="#e0f2fe" emissive="#bae6fd" emissiveIntensity={0.45} />
      </mesh>
      <mesh position={[w / 2 - 0.22, 6.2, 0]}>
        <boxGeometry args={[0.05, 2.1, d - 6]} />
        <meshStandardMaterial color="#e0f2fe" emissive="#bae6fd" emissiveIntensity={0.45} />
      </mesh>

      {/* Overhead Overhead-Crane Longitudinal Runway Rails */}
      <mesh position={[-w / 2 + 1.4, ceilingY - 3.2, 0]}>
        <boxGeometry args={[0.32, 0.48, d - 2]} />
        <meshStandardMaterial color="#d97706" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[w / 2 - 1.4, ceilingY - 3.2, 0]}>
        <boxGeometry args={[0.32, 0.48, d - 2]} />
        <meshStandardMaterial color="#d97706" metalness={0.5} roughness={0.4} />
      </mesh>

      {/* Corrugated Reflective Metal Roof Deck Panel Above Trusses */}
      <mesh position={[0, ceilingY + 0.42, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial
          map={textures.claddingMap}
          color="#f1f5f9"
          roughness={0.42}
          metalness={0.38}
        />
      </mesh>

      {/* Instanced High-Bay Structural Steel Columns */}
      <instancedMesh ref={columnMeshRef} args={[undefined, undefined, columnTransforms.length]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#64748b" metalness={0.55} roughness={0.38} />
      </instancedMesh>

      {/* Instanced Steel Roof Trusses */}
      <instancedMesh ref={trussMeshRef} args={[undefined, undefined, trussMembers.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#475569" metalness={0.65} roughness={0.35} />
      </instancedMesh>

      {/* Instanced High-Bay Industrial LED Luminaires */}
      <instancedMesh ref={lightMeshRef} args={[undefined, undefined, ledFixtures.length]}>
        <boxGeometry args={[3.2, 0.14, 0.55]} />
        <meshStandardMaterial color="#ffffff" emissive="#e0f2fe" emissiveIntensity={1.8} />
      </instancedMesh>

      {/* =================================================================
          REAL BACKEND PRODUCTION LINES & MACHINES
         ================================================================= */}
      {factory.production_lines.map((line) => {
        const lineZ = line.floor_offset_z;
        const machines = line.machines;
        const span = Math.max(26, machines.length * 11.5);

        return (
          <group key={line.id} position={[0, 0, lineZ]}>
            {/* Safety Zone Line Pad with Yellow Border */}
            <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[span, 8.6]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.48} metalness={0.08} />
            </mesh>
            <mesh position={[0, 0.018, 4.35]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[span, 0.14]} />
              <meshStandardMaterial color="#eab308" roughness={0.5} />
            </mesh>
            <mesh position={[0, 0.018, -4.35]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[span, 0.14]} />
              <meshStandardMaterial color="#eab308" roughness={0.5} />
            </mesh>

            {/* Transfer Conveyor Spine */}
            <mesh position={[0, 0.35, -2.0]} castShadow receiveShadow>
              <boxGeometry args={[span - 4, 0.28, 0.85]} />
              <meshStandardMaterial color="#475569" metalness={0.62} roughness={0.34} />
            </mesh>

            {/* Overhead Utility Cable Tray / Busbar Above Production Line */}
            <mesh position={[0, 4.9, -1.8]}>
              <boxGeometry args={[span - 2, 0.14, 0.55]} />
              <meshStandardMaterial color="#64748b" metalness={0.6} roughness={0.35} />
            </mesh>

            {/* Production Line Plaque */}
            <Html position={[-span / 2 - 1.5, 2.8, 0]} center distanceFactor={32}>
              <button
                type="button"
                onClick={() => onEnterLine(line.id)}
                className="rounded-md border border-[#93C5FD] bg-white/95 px-2.5 py-1.5 text-left shadow hover:border-[#2563EB] hover:bg-[#EAF2FC]"
              >
                <div className="font-mono text-[10px] font-bold text-[#2563EB]">{line.code}</div>
                <div className="whitespace-nowrap text-xs font-semibold text-[#14213D]">{line.name}</div>
                <div className="text-[10px] font-medium text-[#2563EB]">Enter Line Journey →</div>
              </button>
            </Html>

            {/* Individual Backend Machines */}
            {machines.map((m) => {
              const effectiveState = liveStates[m.id] ?? m.state;
              return (
                <group key={m.id} position={[m.pos_x, m.pos_y, m.pos_z]} rotation={[0, m.rotation_y, 0]}>
                  <IndustrialMachineMesh
                    machineType={m.machine_type}
                    status={effectiveState?.status ?? "Unknown"}
                    selected={selectedMachineId === m.id}
                    code={m.code}
                    name={m.name}
                    onClick={() => onSelectMachine(m.id)}
                  />
                </group>
              );
            })}
          </group>
        );
      })}
    </group>
  );
};
