import { useState } from 'react'
import { Selections, useStore } from '../useStore'
import { DoubleSide, Vector3, Quaternion } from 'three'
import { Program } from '../lang/abstractSyntaxTree'
import { addNewSketchLn } from '../lang/std/sketch'
import { roundOff } from '../lib/utils'

export const SketchPlane = () => {
  const {
    ast,
    guiMode,
    programMemory,
    updateAstAsync,
    setSelectionRanges,
    selectionRanges,
    isShiftDown,
    setCursor,
  } = useStore((s) => ({
    guiMode: s.guiMode,
    ast: s.ast,
    updateAstAsync: s.updateAstAsync,
    programMemory: s.programMemory,
    setSelectionRanges: s.setSelectionRanges,
    selectionRanges: s.selectionRanges,
    isShiftDown: s.isShiftDown,
    setCursor: s.setCursor,
  }))
  const [xHover, setXHover] = useState(false)
  const [yHover, setYHover] = useState(false)
  if (guiMode.mode !== 'sketch') {
    return null
  }
  if (!(guiMode.sketchMode === 'sketchEdit') && !('isTooltip' in guiMode)) {
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

  const onAxisClick = (name: 'y-axis' | 'x-axis') => () => {
    const _selectionRanges: Selections = isShiftDown
      ? selectionRanges
      : {
          codeBasedSelections: [
            {
              range: [0, 0],
              type: 'default',
            },
          ],
          otherSelections: [],
        }
    if (!isShiftDown) {
      setCursor({
        ..._selectionRanges,
        otherSelections: [name],
      })
    }
    setTimeout(() => {
      setSelectionRanges({
        ..._selectionRanges,
        otherSelections: [name],
      })
    }, 100)
  }

  return (
    <>
      <mesh
        quaternion={clickDetectQuaternion}
        position={position}
        name={sketchGridName}
        onPointerDown={(e) => {
          if (!('isTooltip' in guiMode)) {
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
                nonCodeMeta: {},
              }
          const { modifiedAst } = addNewSketchLn({
            node: _ast,
            programMemory,
            to: [point.x, point.y],
            fnName: guiMode.sketchMode,
            pathToNode: guiMode.pathToNode,
          })
          updateAstAsync(modifiedAst)
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
        args={[50, 50, 'blue', 'hotpink']}
        quaternion={gridQuaternion}
        position={position}
        onClick={() =>
          !isShiftDown &&
          setSelectionRanges({
            ...selectionRanges,
            otherSelections: [],
          })
        }
      />
      <mesh
        onPointerOver={() => setXHover(true)}
        onPointerOut={() => setXHover(false)}
        onClick={onAxisClick('x-axis')}
      >
        <boxGeometry args={[50, 0.2, 0.05]} />
        <meshStandardMaterial
          color={
            selectionRanges.otherSelections.includes('x-axis')
              ? 'skyblue'
              : xHover
              ? '#FF5555'
              : '#FF1111'
          }
        />
      </mesh>
      <mesh
        onPointerOver={() => setYHover(true)}
        onPointerOut={() => setYHover(false)}
        onClick={onAxisClick('y-axis')}
      >
        <boxGeometry args={[0.2, 50, 0.05]} />
        <meshStandardMaterial
          color={
            selectionRanges.otherSelections.includes('y-axis')
              ? 'skyblue'
              : yHover
              ? '#5555FF'
              : '#1111FF'
          }
        />
      </mesh>
    </>
  )
}

function roundy({ x, y, z }: any) {
  return {
    x: roundOff(x, 2),
    y: roundOff(y, 2),
    z: roundOff(z, 2),
  }
}
