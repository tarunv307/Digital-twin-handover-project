import React, { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { ErrorBoundary } from "../layout/ErrorBoundary";

export function detectWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

interface TwinCanvasProps {
  initialCameraPosition?: [number, number, number];
  fov?: number;
  fallback: React.ReactNode;
  children: React.ReactNode;
}

export const TwinCanvas: React.FC<TwinCanvasProps> = ({
  initialCameraPosition = [0, 18, 32],
  fov = 42,
  fallback,
  children,
}) => {
  const webglSupported = useMemo(() => detectWebGL(), []);

  if (!webglSupported) {
    return <>{fallback}</>;
  }

  return (
    <ErrorBoundary fallback={fallback}>
      <div className="relative h-full w-full bg-[#F1F6FD]">
        <Suspense
          fallback={
            <div className="flex h-full w-full items-center justify-center text-xs font-medium text-[#64748B]">
              Initializing 3D Industrial Environment…
            </div>
          }
        >
            <Canvas
            shadows
            dpr={[1, 2]}
            camera={{ position: initialCameraPosition, fov, near: 0.2, far: 550 }}
            gl={{ antialias: true, powerPreference: "high-performance" }}
          >
            <color attach="background" args={["#F1F6FD"]} />
            <fog attach="fog" args={["#F1F6FD", 125, 290]} />

            {/* Clean daylight industrial lighting */}
            <hemisphereLight args={["#ffffff", "#cbd5e1", 0.95]} />
            <directionalLight
              position={[36, 54, 34]}
              intensity={1.38}
              castShadow
              shadow-mapSize-width={2048}
              shadow-mapSize-height={2048}
              shadow-camera-near={5}
              shadow-camera-far={190}
              shadow-camera-left={-85}
              shadow-camera-right={85}
              shadow-camera-top={85}
              shadow-camera-bottom={-85}
              shadow-bias={-0.0004}
            />
            <directionalLight position={[-25, 18, -20]} intensity={0.45} color="#dbeafe" />

            {children}

            <ContactShadows
              position={[0, 0.01, 0]}
              opacity={0.22}
              scale={110}
              blur={2.2}
              far={25}
              resolution={512}
              color="#334155"
            />
          </Canvas>
        </Suspense>
      </div>
    </ErrorBoundary>
  );
};

