import { useStore } from '../useStore'
import { DoubleSide } from 'three'
import { addLine, Program } from '../lang/abstractSyntaxTree'

export const SketchPlane = () => {
  const { ast, setGuiMode, guiMode, updateAst } = useStore(
    ({ guiMode, setGuiMode, ast, updateAst }) => ({
      guiMode,
      setGuiMode,
      ast,
      updateAst,
    })
  )
  if (guiMode.mode !== 'sketch') {
    return null
  }
  if (guiMode.sketchMode !== 'points') {
    return null
  }

  const sketchGridName = 'sketchGrid'

  const ninety = Math.PI / 2
  const gridRotation: [number, number, number] = [0, 0, 0]
  const clickDetectPlaneRotation: [number, number, number] = [0, 0, 0]
  if (guiMode.axis === 'yz') {
    gridRotation[0] = ninety
  } else if (guiMode.axis === 'xy') {
    clickDetectPlaneRotation[0] = ninety
  } else if (guiMode.axis === 'xz') {
    gridRotation[2] = ninety
    clickDetectPlaneRotation[1] = ninety
  }

  return (
    <>
      <mesh
        rotation={clickDetectPlaneRotation}
        name={sketchGridName}
        onClick={(e) => {
          const sketchGridIntersection = e.intersections.find(
            ({ object }) => object.name === sketchGridName
          )
          const point = roundy(sketchGridIntersection?.point)
          let _ast: Program = ast
            ? ast
            : {
                type: 'Program',
                start: 0,
                end: 0,
                body: [],
              }
          const { modifiedAst, id } = addLine(_ast, guiMode.id, [
            point.x,
            point.y,
          ])
          updateAst(modifiedAst)
        }}
      >
        <planeGeometry args={[30, 40]} />
        <meshStandardMaterial
          color="blue"
          side={DoubleSide}
          opacity={0}
          transparent
        />
      </mesh>
      <gridHelper args={[30, 40, 'blue', 'hotpink']} rotation={gridRotation} />
    </>
  )
}

function roundy({ x, y, z }: any) {
  const roundOff = (num: number, places: number): number => {
    const x = Math.pow(10, places)
    return Math.round(num * x) / x
  }
  return {
    x: roundOff(x, 2),
    y: roundOff(y, 2),
    z: roundOff(z, 2),
  }
}
