import React, { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

interface CameraRigProps {
  position: [number, number, number];
  target: [number, number, number];
  enableOrbit?: boolean;
  smoothSpeed?: number;
  minDistance?: number;
  maxDistance?: number;
  maxPolarAngle?: number;
}

export const CameraRig: React.FC<CameraRigProps> = ({
  position,
  target,
  enableOrbit = true,
  smoothSpeed = 4.5,
  minDistance = 4,
  maxDistance = 110,
  maxPolarAngle = Math.PI / 2.12,
}) => {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const desiredPos = useRef(new THREE.Vector3(...position));
  const desiredTarget = useRef(new THREE.Vector3(...target));
  const userInteracting = useRef(false);
  const transitionActive = useRef(true);

  useEffect(() => {
    desiredPos.current.set(...position);
    desiredTarget.current.set(...target);
    transitionActive.current = true;
  }, [position[0], position[1], position[2], target[0], target[1], target[2]]);

  useFrame((_, delta) => {
    const step = 1 - Math.exp(-smoothSpeed * Math.min(delta, 0.1));

    if (!enableOrbit) {
      camera.position.lerp(desiredPos.current, step);
      camera.lookAt(desiredTarget.current);
      return;
    }

    if (transitionActive.current && !userInteracting.current) {
      camera.position.lerp(desiredPos.current, step);
      if (controlsRef.current) {
        controlsRef.current.target.lerp(desiredTarget.current, step);
        controlsRef.current.update();
      }
      if (
        camera.position.distanceTo(desiredPos.current) < 0.05 &&
        (!controlsRef.current || controlsRef.current.target.distanceTo(desiredTarget.current) < 0.05)
      ) {
        transitionActive.current = false;
      }
    }
  });

  if (!enableOrbit) {
    return null;
  }

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={maxPolarAngle}
      minDistance={minDistance}
      maxDistance={maxDistance}
      onStart={() => {
        userInteracting.current = true;
        transitionActive.current = false;
      }}
      onEnd={() => {
        userInteracting.current = false;
      }}
    />
  );
};

