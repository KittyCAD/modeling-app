import React, { useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Allotment } from "allotment";
import { OrbitControls, OrthographicCamera } from "@react-three/drei";
import "allotment/dist/style.css";

function Box({
  from,
  to,
}: {
  from: [number, number, number];
  to: [number, number, number];
}) {
  // This reference will give us direct access to the mesh
  const mesh = useRef<{ rotation: { x: number } }>();
  // Set up state for the hovered and active state
  const [hovered, setHover] = useState(false);
  const [active, setActive] = useState(false);

  const sq = (a: number): number => a * a;
  const center = [
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2,
    (from[2] + to[2]) / 2,
  ];
  const Hypotenuse3d = Math.sqrt(
    sq(from[0] - to[0]) + sq(from[1] - to[1]) + sq(from[2] - to[2])
  );
  const ang1 = -Math.atan2(from[2] - to[2], from[0] - to[0]);
  const Hypotenuse2d = Math.sqrt(sq(from[0] - to[0]) + sq(from[2] - to[2]));
  const ang2 = -Math.atan2(to[1] - from[1], Hypotenuse2d);
  return (
    <group>
      <mesh
        position={center}
        rotation={[0, ang1, ang2]}
        ref={mesh}
        onClick={(event) => setActive(!active)}
        onPointerOver={(event) => setHover(true)}
        onPointerOut={(event) => setHover(false)}
      >
        <boxGeometry args={[Hypotenuse3d, 0.1, 0.1]} />
        <meshStandardMaterial color={hovered ? "hotpink" : "orange"} />
      </mesh>
      <mesh position={to}>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshStandardMaterial color={hovered ? "hotpink" : "orange"} />
      </mesh>
      <mesh position={from}>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshStandardMaterial color={hovered ? "hotpink" : "orange"} />
      </mesh>
    </group>
  );
}

const OrrthographicCamera = OrthographicCamera as any;

function App() {
  const cam = useRef();
  return (
    <div className="h-screen">
      <Allotment>
        <div className="bg-red h-full">
          editor
          <textarea />
        </div>
        <div className="h-full">
          viewer
          <Canvas>
            <OrbitControls
              enableDamping={false}
              enablePan
              enableRotate
              enableZoom
              reverseOrbit={false}
            />
            <OrrthographicCamera
              ref={cam}
              makeDefault
              position={[0, 0, 10]}
              zoom={40}
              rotation={[0, 0, 0]}
            />
            <ambientLight />
            <pointLight position={[10, 10, 10]} />
            <Box from={[6, 6, 6]} to={[0, 1, 5]} />
            <mesh>
              <boxGeometry args={[0.1, 0.2, 1]} />
              <meshStandardMaterial color={"hotpink"} />
            </mesh>
          </Canvas>
        </div>
      </Allotment>
    </div>
  );
}

export default App;
