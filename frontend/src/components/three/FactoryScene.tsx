import React, { useMemo } from "react";
import { CameraRig } from "./CameraRig";
import { FactoryExteriorComplex } from "./FactoryExteriorComplex";
import { FactoryInteriorHall } from "./FactoryInteriorHall";
import type { FactoryDetail } from "../../types/digitalTwin";

export type FactoryViewMode = "exterior" | "interior";
export type InteriorCameraPreset = "overview" | "walk";

interface FactorySceneProps {
  factory: FactoryDetail;
  viewMode: FactoryViewMode;
  interiorPreset?: InteriorCameraPreset;
  selectedMachineId: string | null;
  onEnterFactory: () => void;
  onEnterLine: (lineId: string) => void;
  onSelectMachine: (machineId: string) => void;
}

export const FactoryScene: React.FC<FactorySceneProps> = ({
  factory,
  viewMode,
  interiorPreset = "overview",
  selectedMachineId,
  onEnterFactory,
  onEnterLine,
  onSelectMachine,
}) => {
  const w = Math.max(82, factory.floor_width_m || 90);
  const d = Math.max(52, factory.floor_depth_m || 56);

  const cameraCoords = useMemo((): {
    position: [number, number, number];
    target: [number, number, number];
    minDistance: number;
    maxDistance: number;
    maxPolarAngle: number;
  } => {
    if (viewMode === "exterior") {
      return {
        position: [w * 0.56, 26, d * 0.92],
        target: [0, 5.5, 0],
        minDistance: 22,
        maxDistance: 170,
        maxPolarAngle: Math.PI / 2.15,
      };
    }

    if (selectedMachineId) {
      for (const line of factory.production_lines) {
        const match = line.machines.find((m) => m.id === selectedMachineId);
        if (match) {
          const wz = line.floor_offset_z + match.pos_z;
          return {
            position: [match.pos_x + 4.8, 3.8, wz + 6.4],
            target: [match.pos_x, 1.35, wz],
            minDistance: 3.5,
            maxDistance: 55,
            maxPolarAngle: Math.PI / 2.02,
          };
        }
      }
    }

    if (interiorPreset === "walk") {
      return {
        position: [0, 2.7, d * 0.42],
        target: [0, 2.5, -d * 0.25],
        minDistance: 4,
        maxDistance: 85,
        maxPolarAngle: Math.PI / 2.01,
      };
    }

    return {
      position: [0, 9.6, d * 0.44],
      target: [0, 2.4, -d * 0.14],
      minDistance: 5,
      maxDistance: 95,
      maxPolarAngle: Math.PI / 2.02,
    };
  }, [viewMode, interiorPreset, selectedMachineId, factory.production_lines, w, d]);

  return (
    <>
      <CameraRig
        position={cameraCoords.position}
        target={cameraCoords.target}
        enableOrbit
        smoothSpeed={4.2}
        minDistance={cameraCoords.minDistance}
        maxDistance={cameraCoords.maxDistance}
        maxPolarAngle={cameraCoords.maxPolarAngle}
      />

      {viewMode === "exterior" ? (
        <FactoryExteriorComplex factory={factory} onEnterFactory={onEnterFactory} />
      ) : (
        <FactoryInteriorHall
          factory={factory}
          selectedMachineId={selectedMachineId}
          onSelectMachine={onSelectMachine}
          onEnterLine={onEnterLine}
        />
      )}
    </>
  );
};
