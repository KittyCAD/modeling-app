import { useStore } from '../useStore'
import { DoubleSide, Vector3, Quaternion } from 'three'
import { Program } from '../lang/abstractSyntaxTree'
import { addLine } from '../lang/modifyAst'

export const SketchPlane = () => {
  const { ast, guiMode, updateAst } = useStore(
    ({ guiMode, ast, updateAst }) => ({
      guiMode,
      ast,
      updateAst,
    })
  )
  if (guiMode.mode !== 'sketch') {
    return null
  }
  if (guiMode.sketchMode !== 'points' && guiMode.sketchMode !== 'sketchEdit') {
    return null
  }

  const sketchGridName = 'sketchGrid'

  let clickDetectQuaternion = new Quaternion(...guiMode.rotation)

  let temp = new Quaternion().setFromAxisAngle(
    new Vector3(1, 0, 0),
    Math.PI / 2
  )
  let position = guiMode.position
  const gridQuaternion = new Quaternion().multiplyQuaternions(
    new Quaternion(...guiMode.rotation),
    temp
  )

  return (
    <>
      <mesh
        quaternion={clickDetectQuaternion}
        position={position}
        name={sketchGridName}
        onClick={(e) => {
          if (guiMode.sketchMode !== 'points') {
            return
          }
          const sketchGridIntersection = e.intersections.find(
            ({ object }) => object.name === sketchGridName
          )
          const inverseQuaternion = clickDetectQuaternion.clone().invert()
          let transformedPoint = sketchGridIntersection?.point.clone()
          if (transformedPoint) {
            transformedPoint.applyQuaternion(inverseQuaternion)
            transformedPoint?.sub(
              new Vector3(...position).applyQuaternion(inverseQuaternion)
            )
          }

          const point = roundy(transformedPoint)
          let _ast: Program = ast
            ? ast
            : {
                type: 'Program',
                start: 0,
                end: 0,
                body: [],
              }
          const addLinePoint: [number, number] = [point.x, point.y]
          const { modifiedAst } = addLine(
            _ast,
            guiMode.pathToNode,
            addLinePoint
          )
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
      <gridHelper
        args={[30, 40, 'blue', 'hotpink']}
        quaternion={gridQuaternion}
        position={position}
      />
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
