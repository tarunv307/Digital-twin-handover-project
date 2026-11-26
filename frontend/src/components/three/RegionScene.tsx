import React, { useState } from "react";
import { Grid } from "@react-three/drei";
import { CameraRig } from "./CameraRig";
import { FactoryBuildingModel } from "./IndustrialAssets";
import type { RegionDetail } from "../../types/digitalTwin";

interface RegionSceneProps {
  region: RegionDetail;
  onSelectFactory: (factoryId: string) => void;
}

export const RegionScene: React.FC<RegionSceneProps> = ({ region, onSelectFactory }) => {
  const [hoveredFactory, setHoveredFactory] = useState<string | null>(null);

  return (
    <>
      <CameraRig position={[0, 18, 28]} target={[0, 1.5, 0]} enableOrbit maxDistance={70} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[120, 90]} />
        <meshStandardMaterial color="#EAF2FC" roughness={0.92} />
      </mesh>
      <Grid
        position={[0, 0.01, 0]}
        args={[90, 70]}
        cellSize={2}
        cellThickness={0.5}
        cellColor="#DCE6F2"
        sectionSize={10}
        sectionThickness={1}
        sectionColor="#B4C8E2"
        fadeDistance={85}
      />

      {/* Industrial Park Roadway */}
      <mesh position={[0, 0.03, 10]} receiveShadow>
        <boxGeometry args={[52, 0.05, 3.6]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.85} />
      </mesh>

      {region.factories.map((fac, idx) => {
        const count = region.factories.length;
        const posX = count === 1 ? 0 : (idx - (count - 1) / 2) * 18;
        return (
          <FactoryBuildingModel
            key={fac.id}
            position={[posX, 0, 0]}
            size={[12.5, 4.6, 9]}
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
    </>
  );
};

