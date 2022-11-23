import React, { useRef, useState, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { Allotment } from "allotment";
import { OrbitControls, OrthographicCamera } from "@react-three/drei";
import "allotment/dist/style.css";
import { lexer } from "./lang/tokeniser";
import { abstractSyntaxTree } from "./lang/abstractSyntaxTree";
import { executor } from "./lang/executor";
import { BufferGeometry } from "three";
// import { Box } from "./lang/engine";

const _code = `sketch mySketch {
  path myPath = lineTo(0,1)
  lineTo(1,5)
  path rightPath = lineTo(1,0)
  close()
}
show(mySketch)`;

const OrrthographicCamera = OrthographicCamera as any;

function App() {
  const cam = useRef();
  const [code, setCode] = useState(_code);
  const [geoArray, setGeoArray] = useState<
    { geo: BufferGeometry; sourceRange: [number, number] }[]
  >([]);
  useEffect(() => {
    try {
      const tokens = lexer(code);
      const ast = abstractSyntaxTree(tokens);
      const programMemory = executor(ast);
      const geos: { geo: BufferGeometry; sourceRange: [number, number] }[] =
        programMemory.root.mySketch
          .map(
            ({
              geo,
              sourceRange,
            }: {
              geo: BufferGeometry;
              sourceRange: [number, number];
            }) => ({ geo, sourceRange })
          )
          .filter((a: any) => !!a.geo);
      setGeoArray(geos);
      console.log("length", geos.length, geos);
      console.log(programMemory);
    } catch (e) {
      console.log(e);
    }
  }, [code]);
  return (
    <div className="h-screen">
      <Allotment>
        <div className="bg-red h-full">
          <textarea
            className="w-full p-4 h-64 font-mono"
            onChange={(a) => setCode(a.target.value)}
            value={code}
          >
            {code}
          </textarea>
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
            {geoArray.map(
              (
                {
                  geo,
                  sourceRange,
                }: { geo: BufferGeometry; sourceRange: [number, number] },
                index
              ) => <Line key={index} geo={geo} sourceRange={sourceRange} />
              
            )}
          </Canvas>
        </div>
      </Allotment>
    </div>
  );
}

export default App;

function Line({
  geo,
  sourceRange,
}: {
  geo: BufferGeometry;
  sourceRange: [number, number];
}) {
  // This reference will give us direct access to the mesh
  // const ref = useRef<Mesh<BufferGeometry | Material | Material[]> | undefined>();
  const ref = useRef<BufferGeometry | undefined>() as any;
  // Set up state for the hovered and active state
  const [hovered, setHover] = useState(false);

  return (
    <mesh
      ref={ref}
      onPointerOver={(event) => setHover(true)}
      onPointerOut={(event) => setHover(false)}
    >
      <primitive object={geo} />
      <meshStandardMaterial color={hovered ? "hotpink" : "orange"} />
    </mesh>
  );
}
