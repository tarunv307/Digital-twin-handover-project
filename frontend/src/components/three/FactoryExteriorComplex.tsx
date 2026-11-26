import React, { useEffect, useMemo, useRef, useState } from "react";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { getIndustrialTextures } from "./IndustrialTextures";
import type { FactoryDetail } from "../../types/digitalTwin";

interface FactoryExteriorComplexProps {
  factory: FactoryDetail;
  onEnterFactory: () => void;
}

export const FactoryExteriorComplex: React.FC<FactoryExteriorComplexProps> = ({
  factory,
  onEnterFactory,
}) => {
  const textures = useMemo(() => getIndustrialTextures(), []);
  const w = Math.max(82, factory.floor_width_m || 90);
  const d = Math.max(52, factory.floor_depth_m || 56);
  const hallH = 12.6;

  // Deterministic subtle campus variation per plant ID without faking backend data
  const mirrorProcessYard = factory.id === "fac-hsr-b" || factory.id === "fac-dtw-d";
  const dirSign = mirrorProcessYard ? -1 : 1;

  const [gateHovered, setGateHovered] = useState(false);

  // Instanced structural lattice beams for the tall steel frame next to silos
  const latticeRef = useRef<THREE.InstancedMesh>(null);
  const louverRef = useRef<THREE.InstancedMesh>(null);
  const treeCanopyRef = useRef<THREE.InstancedMesh>(null);

  const latticeTransforms = useMemo(() => {
    const items: Array<{ pos: [number, number, number]; scale: [number, number, number]; rotY?: number; rotZ?: number }> = [];
    const baseX = dirSign * (-w * 0.5 - 15);
    const baseZ = -d * 0.24;
    const cols = [-3.2, 3.2];
    const zRows = [-3.2, 3.2];
    // 4 vertical tower corner legs (22m)
    cols.forEach((cx) =>
      zRows.forEach((cz) => {
        items.push({ pos: [baseX + cx, 11, baseZ + cz], scale: [0.38, 22, 0.38] });
      })
    );
    // Horizontal girts & cross-braces at 5 levels
    [4.4, 8.8, 13.2, 17.6, 21.6].forEach((y) => {
      zRows.forEach((cz) => {
        items.push({ pos: [baseX, y, baseZ + cz], scale: [6.4, 0.24, 0.24] });
      });
      cols.forEach((cx) => {
        items.push({ pos: [baseX + cx, y, baseZ], scale: [0.24, 0.24, 6.4] });
      });
    });
    // Bracing struts on front face
    [2.2, 6.6, 11, 15.4, 19.6].forEach((y) => {
      items.push({ pos: [baseX, y, baseZ + 3.2], scale: [0.14, 7.6, 0.14], rotZ: 0.96 });
      items.push({ pos: [baseX, y, baseZ + 3.2], scale: [0.14, 7.6, 0.14], rotZ: -0.96 });
    });
    return items;
  }, [w, d, dirSign]);

  // Rooftop HVAC & wall structural pilasters via instancing
  const pilasters = useMemo(() => {
    const out: Array<{ pos: [number, number, number]; scale: [number, number, number] }> = [];
    const bayCount = 9;
    for (let i = 0; i <= bayCount; i += 1) {
      const px = -w / 2 + (w / bayCount) * i;
      out.push({ pos: [px, hallH / 2, d / 2 + 0.18], scale: [0.42, hallH, 0.36] });
      out.push({ pos: [px, hallH / 2, -d / 2 - 0.18], scale: [0.42, hallH, 0.36] });
    }
    return out;
  }, [w, d, hallH]);

  // Campus trees positioned naturally along outer road perimeter
  const trees = useMemo(() => {
    const coords: Array<[number, number, number]> = [
      [-w * 0.56, 0, d * 0.64],
      [-w * 0.36, 0, d * 0.68],
      [-w * 0.18, 0, d * 0.66],
      [w * 0.24, 0, d * 0.65],
      [w * 0.44, 0, d * 0.63],
      [w * 0.62, 0, d * 0.42],
      [-w * 0.66, 0, d * 0.36],
      [-w * 0.72, 0, -d * 0.18],
      [w * 0.68, 0, -d * 0.28],
    ];
    return coords;
  }, [w, d]);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    if (latticeRef.current) {
      latticeTransforms.forEach((item, idx) => {
        dummy.position.set(...item.pos);
        dummy.rotation.set(0, item.rotY ?? 0, item.rotZ ?? 0);
        dummy.scale.set(...item.scale);
        dummy.updateMatrix();
        latticeRef.current!.setMatrixAt(idx, dummy.matrix);
      });
      latticeRef.current.instanceMatrix.needsUpdate = true;
    }
    if (louverRef.current) {
      pilasters.forEach((item, idx) => {
        dummy.position.set(...item.pos);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(...item.scale);
        dummy.updateMatrix();
        louverRef.current!.setMatrixAt(idx, dummy.matrix);
      });
      louverRef.current.instanceMatrix.needsUpdate = true;
    }
    if (treeCanopyRef.current) {
      trees.forEach(([x, y, z], idx) => {
        dummy.position.set(x, y + 3.1, z);
        dummy.rotation.set(0, idx * 0.7, 0);
        const s = 1.6 + (idx % 3) * 0.35;
        dummy.scale.set(s, s * 1.15, s);
        dummy.updateMatrix();
        treeCanopyRef.current!.setMatrixAt(idx, dummy.matrix);
      });
      treeCanopyRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [latticeTransforms, pilasters, trees]);

  const siloClusterX = dirSign * (-w * 0.5 - 15);
  const processTowerX = dirSign * (w * 0.5 + 14);

  return (
    <group>
      {/* Surrounding Natural Industrial Terrain & Campus Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]} receiveShadow>
        <planeGeometry args={[320, 260]} />
        <meshStandardMaterial color="#cfdbe8" roughness={0.95} metalness={0.02} />
      </mesh>

      {/* Main Plant Concrete Apron Slab */}
      <mesh position={[0, 0.04, 4]} receiveShadow>
        <boxGeometry args={[w + 56, 0.1, d + 34]} />
        <meshStandardMaterial
          map={textures.concreteMap}
          roughnessMap={textures.concreteRoughnessMap}
          color="#cbd5e1"
          roughness={0.86}
        />
      </mesh>

      {/* Main Asphalt Perimeter Access Road */}
      <mesh position={[0, 0.1, d * 0.5 + 12]} receiveShadow>
        <boxGeometry args={[w + 76, 0.06, 8.6]} />
        <meshStandardMaterial map={textures.asphaltMap} color="#475569" roughness={0.88} />
      </mesh>
      {/* Road Center Dashed Striping */}
      {[-36, -24, -12, 0, 12, 24, 36].map((rx) => (
        <mesh key={rx} position={[rx, 0.135, d * 0.5 + 12]}>
          <boxGeometry args={[4.5, 0.01, 0.18]} />
          <meshStandardMaterial color="#eab308" roughness={0.6} />
        </mesh>
      ))}
      {/* Service Branch Road into Loading Bays */}
      <mesh position={[0, 0.1, d * 0.5 + 4.5]} receiveShadow>
        <boxGeometry args={[w * 0.65, 0.05, 7.2]} />
        <meshStandardMaterial map={textures.asphaltMap} color="#525f70" roughness={0.86} />
      </mesh>

      {/* =================================================================
          MAIN INDUSTRIAL MANUFACTURING HALL EXTERIOR
         ================================================================= */}
      <group position={[0, 0.1, 0]}>
        {/* Lower Concrete Plinth Wall */}
        <mesh position={[0, 1.4, 0]} castShadow receiveShadow>
          <boxGeometry args={[w + 0.4, 2.8, d + 0.4]} />
          <meshStandardMaterial map={textures.siloConcreteMap} color="#94a3b8" roughness={0.85} />
        </mesh>

        {/* Upper Corrugated Metal Cladding Hall Volume */}
        <mesh position={[0, 7.6, 0]} castShadow receiveShadow>
          <boxGeometry args={[w, 9.8, d]} />
          <meshStandardMaterial
            map={textures.claddingMap}
            color="#e2e8f0"
            metalness={0.42}
            roughness={0.48}
          />
        </mesh>

        {/* Ribbed Cladding Roof Parapet & Fascia Trim */}
        <mesh position={[0, hallH + 0.25, 0]} castShadow>
          <boxGeometry args={[w + 1.0, 0.65, d + 1.0]} />
          <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.38} />
        </mesh>
        <mesh position={[0, hallH + 0.65, 0]} receiveShadow>
          <boxGeometry args={[w - 1.5, 0.3, d - 1.5]} />
          <meshStandardMaterial color="#64748b" metalness={0.35} roughness={0.62} />
        </mesh>

        {/* Clerestory Daylight Window Ribbon Along Front & Sides */}
        <mesh position={[0, 8.8, d / 2 + 0.06]}>
          <boxGeometry args={[w - 4, 1.65, 0.08]} />
          <meshStandardMaterial
            color="#93c5fd"
            emissive="#dbeafe"
            emissiveIntensity={0.28}
            metalness={0.82}
            roughness={0.14}
          />
        </mesh>
        <mesh position={[0, 8.8, -d / 2 - 0.06]}>
          <boxGeometry args={[w - 4, 1.65, 0.08]} />
          <meshStandardMaterial color="#93c5fd" metalness={0.82} roughness={0.14} />
        </mesh>
        <mesh position={[w / 2 + 0.06, 8.8, 0]}>
          <boxGeometry args={[0.08, 1.65, d - 4]} />
          <meshStandardMaterial color="#93c5fd" metalness={0.82} roughness={0.14} />
        </mesh>
        <mesh position={[-w / 2 - 0.06, 8.8, 0]}>
          <boxGeometry args={[0.08, 1.65, d - 4]} />
          <meshStandardMaterial color="#93c5fd" metalness={0.82} roughness={0.14} />
        </mesh>

        {/* Instanced Exterior Structural Pilasters */}
        <instancedMesh ref={louverRef} args={[undefined, undefined, pilasters.length]} castShadow>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#475569" metalness={0.55} roughness={0.4} />
        </instancedMesh>

        {/* Rooftop HVAC Units, Skylights & Exhaust Ducts */}
        {[-w * 0.28, -w * 0.08, w * 0.14, w * 0.32].map((hx, idx) => (
          <group key={idx} position={[hx, hallH + 1.15, idx % 2 === 0 ? -d * 0.18 : d * 0.16]}>
            <mesh castShadow>
              <boxGeometry args={[4.4, 1.35, 3.2]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.45} roughness={0.42} />
            </mesh>
            <mesh position={[0, 0.78, 0]}>
              <cylinderGeometry args={[0.9, 1.0, 0.35, 16]} />
              <meshStandardMaterial color="#334155" metalness={0.65} roughness={0.35} />
            </mesh>
          </group>
        ))}

        {/* Loading Bay Roll-Up Doors Along Front Wall */}
        {[-w * 0.32, -w * 0.18, w * 0.18, w * 0.32].map((dx, idx) => (
          <group key={idx} position={[dx, 2.2, d / 2 + 0.22]}>
            <mesh>
              <boxGeometry args={[4.2, 4.2, 0.12]} />
              <meshStandardMaterial color="#475569" metalness={0.5} roughness={0.5} />
            </mesh>
            <mesh position={[0, 2.25, 0.25]}>
              <boxGeometry args={[4.8, 0.22, 0.7]} />
              <meshStandardMaterial color="#1e293b" metalness={0.6} roughness={0.4} />
            </mesh>
          </group>
        ))}

        {/* Interactive Main Entrance Portal ("Enter Factory") */}
        <group
          position={[0, 0, d / 2 + 0.35]}
          onClick={(e) => {
            e.stopPropagation();
            onEnterFactory();
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = "pointer";
            setGateHovered(true);
          }}
          onPointerOut={() => {
            document.body.style.cursor = "auto";
            setGateHovered(false);
          }}
        >
          {/* Steel Canopy Portico */}
          <mesh position={[0, 4.9, 1.4]} castShadow>
            <boxGeometry args={[12.5, 0.45, 3.6]} />
            <meshStandardMaterial color="#1e3a8a" metalness={0.55} roughness={0.35} />
          </mesh>
          {/* Illuminated Glass Atrium / Main Roll-Up Bay */}
          <mesh position={[0, 2.4, 0]}>
            <boxGeometry args={[9.4, 4.8, 0.35]} />
            <meshStandardMaterial
              color={gateHovered ? "#60a5fa" : "#bfdbfe"}
              emissive={gateHovered ? "#2563eb" : "#3b82f6"}
              emissiveIntensity={gateHovered ? 0.55 : 0.22}
              metalness={0.7}
              roughness={0.2}
            />
          </mesh>
          {/* Fascia Signboard with Factory Code & Name */}
          <mesh position={[0, 5.75, 0.3]}>
            <boxGeometry args={[14, 1.35, 0.25]} />
            <meshStandardMaterial color="#14213d" metalness={0.4} roughness={0.45} />
          </mesh>

          <Html position={[0, 6.2, 2.2]} center distanceFactor={38}>
            <button
              type="button"
              onClick={onEnterFactory}
              className="rounded-lg border-2 border-[#2563EB] bg-white/95 px-4 py-2 text-center shadow-lg transition hover:scale-105 hover:bg-[#EAF2FC]"
            >
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#2563EB]">
                {factory.code} • Main Entrance
              </div>
              <div className="whitespace-nowrap text-xs font-extrabold text-[#14213D]">
                {factory.name}
              </div>
              <div className="mt-1 inline-flex items-center gap-1 rounded bg-[#2563EB] px-2.5 py-0.5 text-[11px] font-bold text-white">
                Enter Factory →
              </div>
            </button>
          </Html>
        </group>
      </group>

      {/* =================================================================
          CLUSTERED CONCRETE STORAGE SILOS & STEEL STRUCTURAL FRAMEWORK (Ref Img 1 Left)
         ================================================================= */}
      <group position={[siloClusterX, 0.1, 0]}>
        {/* Structural Lattice Frame */}
        <instancedMesh ref={latticeRef} args={[undefined, undefined, latticeTransforms.length]} castShadow>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#334155" metalness={0.68} roughness={0.35} />
        </instancedMesh>

        {/* 4 Primary Cylindrical Concrete/Steel Silos */}
        {[
          [-4.2, -3.5, 21.5, 2.9],
          [4.2, -3.5, 22.8, 3.0],
          [-4.2, 3.5, 20.5, 2.8],
          [4.2, 3.5, 21.0, 2.9],
        ].map(([sx, sz, sh, sr], idx) => (
          <group key={idx} position={[sx, 0, sz]}>
            {/* Main Silo Cylinder */}
            <mesh position={[0, sh / 2, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[sr, sr, sh, 28]} />
              <meshStandardMaterial
                map={textures.siloConcreteMap}
                color="#cbd5e1"
                roughness={0.78}
                metalness={0.12}
              />
            </mesh>
            {/* Conical Steel Top Dome & Penthouse Cap */}
            <mesh position={[0, sh + 1.0, 0]} castShadow>
              <coneGeometry args={[sr + 0.15, 2.0, 24]} />
              <meshStandardMaterial color="#475569" metalness={0.55} roughness={0.4} />
            </mesh>
            {/* Horizontal Steel Stiffener Collar Rings */}
            {[sh * 0.35, sh * 0.72, sh - 0.3].map((ry, rIdx) => (
              <mesh key={rIdx} position={[0, ry, 0]}>
                <cylinderGeometry args={[sr + 0.08, sr + 0.08, 0.25, 24]} />
                <meshStandardMaterial color="#334155" metalness={0.65} roughness={0.35} />
              </mesh>
            ))}
          </group>
        ))}

        {/* Rooftop Penthouse Collector Connecting Silos to Lattice */}
        <mesh position={[0, 22.2, 0]} castShadow>
          <boxGeometry args={[12.8, 2.2, 10.2]} />
          <meshStandardMaterial color="#475569" metalness={0.55} roughness={0.4} />
        </mesh>

        {/* Secondary Standalone Blending Silo Near Roadway */}
        <group position={[dirSign * 3.5, 0, d * 0.38]}>
          <mesh position={[0, 7.5, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[2.3, 2.3, 15, 24]} />
            <meshStandardMaterial
              map={textures.siloConcreteMap}
              color="#d1d5db"
              roughness={0.75}
              metalness={0.15}
            />
          </mesh>
          <mesh position={[0, 15.6, 0]} castShadow>
            <boxGeometry args={[3.4, 1.2, 3.4]} />
            <meshStandardMaterial color="#475569" metalness={0.55} roughness={0.4} />
          </mesh>
        </group>

        {/* Overhead Enclosed Conveyor & Pipe Bridge into Main Hall */}
        <mesh
          position={[dirSign * -dirSign * (w * 0.16), 7.2, 0]}
          rotation={[0, 0, dirSign * 0.14]}
          castShadow
        >
          <boxGeometry args={[22, 1.5, 1.8]} />
          <meshStandardMaterial color="#64748b" metalness={0.62} roughness={0.38} />
        </mesh>
      </group>

      {/* =================================================================
          TALL MULTI-LEVEL PRODUCTION TOWER & PROCESS PIPES (Ref Img 1 Right/Center)
         ================================================================= */}
      <group position={[processTowerX, 0.1, -d * 0.08]}>
        {/* Split Reinforced Concrete Core Walls */}
        <mesh position={[-3.2, 13.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.2, 27, 7.2]} />
          <meshStandardMaterial map={textures.siloConcreteMap} color="#b8c2cc" roughness={0.8} />
        </mesh>
        <mesh position={[3.2, 13.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.2, 27, 7.2]} />
          <meshStandardMaterial map={textures.siloConcreteMap} color="#b8c2cc" roughness={0.8} />
        </mesh>

        {/* Multi-Tier Process Platforms with Warm Industrial Worklight Accent (Ref Img 1) */}
        {[4.5, 9.2, 14.0, 18.8, 23.5].map((py, idx) => (
          <group key={idx} position={[0, py, 0]}>
            <mesh castShadow>
              <boxGeometry args={[5.8, 0.45, 6.8]} />
              <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
            </mesh>
            {/* Process Vessel Cylinder inside tower bay */}
            {idx % 2 === 0 && (
              <mesh position={[0, 2.0, 0]} castShadow>
                <cylinderGeometry args={[1.3, 1.5, 3.6, 16]} />
                <meshStandardMaterial color="#475569" metalness={0.65} roughness={0.35} />
              </mesh>
            )}
            {/* Warm Interior Worklight Strip */}
            <mesh position={[0, 0.5, 2.6]}>
              <boxGeometry args={[2.4, 0.25, 0.25]} />
              <meshStandardMaterial
                color="#fbbf24"
                emissive="#f59e0b"
                emissiveIntensity={1.6}
                roughness={0.2}
              />
            </mesh>
          </group>
        ))}

        {/* Warm Ambient Glow Light inside Tower Frame */}
        <pointLight position={[0, 14, 3.5]} color="#f59e0b" intensity={18} distance={28} decay={1.8} />

        {/* Tower Top Penthouse Headhouse */}
        <mesh position={[0, 27.6, 0]} castShadow>
          <boxGeometry args={[9.2, 2.2, 7.8]} />
          <meshStandardMaterial color="#1e293b" metalness={0.6} roughness={0.38} />
        </mesh>

        {/* Tall Flue Exhaust Stack Adjacent to Tower */}
        <mesh position={[-5.4, 15.5, 2.6]} castShadow>
          <cylinderGeometry args={[0.82, 1.15, 31, 20]} />
          <meshStandardMaterial color="#64748b" metalness={0.55} roughness={0.42} />
        </mesh>
        <mesh position={[-5.4, 30.8, 2.6]}>
          <cylinderGeometry args={[0.88, 0.88, 0.6, 20]} />
          <meshStandardMaterial color="#dc2626" roughness={0.45} />
        </mesh>

        {/* Inclined Heavy Process Ducts Connecting Tower to Production Hall */}
        <mesh
          position={[dirSign * -11, 11.5, 0]}
          rotation={[0, 0, dirSign * -0.45]}
          castShadow
        >
          <cylinderGeometry args={[0.85, 0.85, 18, 16]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.68} roughness={0.32} />
        </mesh>
        <mesh
          position={[dirSign * -11, 15.5, -1.8]}
          rotation={[0, 0, dirSign * -0.35]}
          castShadow
        >
          <cylinderGeometry args={[0.55, 0.55, 17, 14]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.7} roughness={0.3} />
        </mesh>
      </group>

      {/* =================================================================
          AUXILIARY UTILITY BUILDING, SUBSTATION & PIPE RACK
         ================================================================= */}
      <group position={[dirSign * (w * 0.25), 0.1, d * 0.5 + 4.8]}>
        {/* Compact Ground-Level Control & Dispatch Office */}
        <mesh position={[0, 1.8, 0]} castShadow receiveShadow>
          <boxGeometry args={[9.5, 3.6, 5.2]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.55} metalness={0.2} />
        </mesh>
        <mesh position={[0, 3.7, 0]} castShadow>
          <boxGeometry args={[9.9, 0.25, 5.6]} />
          <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.4} />
        </mesh>
        <mesh position={[0, 2.1, 2.63]}>
          <boxGeometry args={[6.4, 1.2, 0.08]} />
          <meshStandardMaterial color="#60a5fa" emissive="#93c5fd" emissiveIntensity={0.35} roughness={0.2} />
        </mesh>
      </group>

      {/* Elevated External Utility Pipe Bridge */}
      <group position={[0, 4.6, -d * 0.5 - 5.2]}>
        <mesh castShadow>
          <boxGeometry args={[w + 26, 0.45, 2.2]} />
          <meshStandardMaterial color="#475569" metalness={0.65} roughness={0.35} />
        </mesh>
        {[-0.45, 0, 0.45].map((pz, idx) => (
          <mesh key={idx} position={[0, 0.45, pz]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.2, 0.2, w + 24, 12]} />
            <meshStandardMaterial color={idx === 1 ? "#2563eb" : "#94a3b8"} metalness={0.72} roughness={0.28} />
          </mesh>
        ))}
        {[-w * 0.42, -w * 0.14, w * 0.14, w * 0.42].map((px, idx) => (
          <mesh key={idx} position={[px, -2.3, 0]} castShadow>
            <boxGeometry args={[0.45, 4.6, 1.8]} />
            <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
          </mesh>
        ))}
      </group>

      {/* Yard Light Poles */}
      {[-w * 0.4, -w * 0.15, w * 0.15, w * 0.4].map((lx, idx) => (
        <group key={idx} position={[lx, 0.1, d * 0.5 + 16.5]}>
          <mesh position={[0, 3.8, 0]} castShadow>
            <cylinderGeometry args={[0.1, 0.15, 7.6, 8]} />
            <meshStandardMaterial color="#475569" metalness={0.7} roughness={0.35} />
          </mesh>
          <mesh position={[0, 7.6, -0.5]}>
            <boxGeometry args={[0.6, 0.18, 1.1]} />
            <meshStandardMaterial color="#fde68a" emissive="#fbbf24" emissiveIntensity={1.1} />
          </mesh>
        </group>
      ))}

      {/* Perimeter Campus Landscaping Trees */}
      {trees.map(([x, y, z], idx) => (
        <mesh key={idx} position={[x, y + 1.0, z]} castShadow>
          <cylinderGeometry args={[0.18, 0.28, 2.0, 8]} />
          <meshStandardMaterial color="#5c4033" roughness={0.9} />
        </mesh>
      ))}
      <instancedMesh ref={treeCanopyRef} args={[undefined, undefined, trees.length]} castShadow>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#2f5e3b" roughness={0.88} />
      </instancedMesh>
    </group>
  );
};
