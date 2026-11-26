import React, { useState } from "react";
import { Html, Grid } from "@react-three/drei";
import { CameraRig } from "./CameraRig";
import { FactoryBuildingModel } from "./IndustrialAssets";
import type { CompanyOverview, FactorySummary, RegionDetail } from "../../types/digitalTwin";

interface CompanySceneProps {
  company: CompanyOverview;
  onSelectRegion: (regionId: string) => void;
  onSelectFactory: (factoryId: string) => void;
}

export const CompanyScene: React.FC<CompanySceneProps> = ({
  company,
  onSelectRegion,
  onSelectFactory,
}) => {
  const [hoveredFactory, setHoveredFactory] = useState<string | null>(null);
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);

  return (
    <>
      <CameraRig position={[0, 26, 44]} target={[0, 1, 0]} enableOrbit maxDistance={95} />

      {/* Enterprise Campus Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[180, 140]} />
        <meshStandardMaterial color="#EAF2FC" roughness={0.95} />
      </mesh>
      <Grid
        position={[0, 0.01, 0]}
        args={[140, 100]}
        cellSize={2}
        cellThickness={0.5}
        cellColor="#DCE6F2"
        sectionSize={10}
        sectionThickness={1}
        sectionColor="#B4C8E2"
        fadeDistance={115}
      />

      {/* Logistics Spine Road connecting Regions */}
      <mesh position={[0, 0.03, 0]} receiveShadow>
        <boxGeometry args={[64, 0.05, 3.2]} />
        <meshStandardMaterial color="#9BB2CE" roughness={0.8} />
      </mesh>

      {company.regions.map((region: RegionDetail) => (
        <group key={region.id} position={[region.map_x, 0, region.map_z]}>
          {/* Regional Industrial Zone Pad */}
          <mesh
            position={[0, 0.04, 0]}
            receiveShadow
            onClick={(e) => {
              e.stopPropagation();
              onSelectRegion(region.id);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = "pointer";
              setHoveredRegion(region.id);
            }}
            onPointerOut={() => {
              document.body.style.cursor = "auto";
              setHoveredRegion(null);
            }}
          >
            <boxGeometry args={[22, 0.08, 17]} />
            <meshStandardMaterial
              color={hoveredRegion === region.id ? "#E3EEFF" : "#FFFFFF"}
              roughness={0.85}
            />
          </mesh>

          {/* Zone border marker */}
          <mesh position={[0, 0.09, -8.35]}>
            <boxGeometry args={[22, 0.1, 0.25]} />
            <meshStandardMaterial color="#2563EB" />
          </mesh>

          {/* Region Header Plaque */}
          <Html position={[0, 0.6, -9.2]} center distanceFactor={36}>
            <button
              type="button"
              onClick={() => onSelectRegion(region.id)}
              className="rounded-md border border-slate-300 bg-white/95 px-3 py-1.5 text-left shadow hover:border-blue-600"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] font-bold text-blue-700">{region.code}</span>
                <span className="text-[10px] text-slate-500">{region.timezone}</span>
              </div>
              <div className="text-xs font-bold text-slate-900">{region.name}</div>
              <div className="mt-0.5 font-mono text-[10px] text-slate-600">
                {region.summary.total_factories} Factories • {region.summary.total_machines} Machines • OEE{" "}
                {region.summary.overall_oee}%
              </div>
            </button>
          </Html>

          {/* Regional Factories */}
          {region.factories.map((fac: FactorySummary, idx: number) => {
            const offsetX = region.factories.length === 1 ? 0 : idx === 0 ? -5.4 : 5.4;
            return (
              <FactoryBuildingModel
                key={fac.id}
                position={[offsetX, 0.08, 0.5]}
                size={[8.2, 3.6, 6.2]}
                title={fac.name}
                code={fac.code}
                oee={fac.summary.overall_oee}
                running={fac.summary.running_machines}
                total={fac.summary.total_machines}
                faults={fac.summary.faulted_machines}
                pendingHandovers={fac.summary.pending_handovers}
                hovered={hoveredFactory === fac.id}
                onHover={(h) => setHoveredFactory(h ? fac.id : null)}
                onClick={() => onSelectFactory(fac.id)}
              />
            );
          })}
        </group>
      ))}
    </>
  );
};

