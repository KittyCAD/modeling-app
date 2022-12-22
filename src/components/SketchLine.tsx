import { useRef, useState, useEffect, useMemo } from 'react'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
  CallExpression,
  changeArguments,
} from '../lang/abstractSyntaxTree'
import { ViewerArtifact } from '../lang/executor'
import { BufferGeometry } from 'three'
import { useStore } from '../useStore'
import { isOverlapping } from '../lib/utils'
import { LineGeos } from '../lang/engine'
import { Vector3, DoubleSide, Quaternion, Vector2 } from 'three'

function useHeightlight(sourceRange: [number, number]) {
  const { selectionRange, guiMode, setGuiMode, ast } = useStore((s) => ({
    setHighlightRange: s.setHighlightRange,
    selectionRange: s.selectionRange,
    guiMode: s.guiMode,
    setGuiMode: s.setGuiMode,
    ast: s.ast,
  }))
  // This reference will give us direct access to the mesh
  const [editorCursor, setEditorCursor] = useState(false)
  const [didSetCanEdit, setDidSetCanEdit] = useState(false)
  useEffect(() => {
    const shouldHighlight = isOverlapping(sourceRange, selectionRange)
    setEditorCursor(shouldHighlight)
    if (shouldHighlight && guiMode.mode === 'default' && ast) {
      const pathToNode = getNodePathFromSourceRange(ast, sourceRange)
      const piper = getNodeFromPath(ast, pathToNode, 'PipeExpression')
      const quaternion = new Quaternion()
      if (piper.type === 'PipeExpression') {
        const rotateName = piper?.body?.[1]?.callee?.name
        const rotateValue = piper?.body?.[1]?.arguments[0].value
        let rotateAxis = new Vector3(1, 0, 0)
        if (rotateName === 'ry') {
          rotateAxis = new Vector3(0, 1, 0)
        } else if (rotateName === 'rz') {
          rotateAxis = new Vector3(0, 0, 1)
        }
        quaternion.setFromAxisAngle(rotateAxis, (Math.PI * rotateValue) / 180)
      }
      const axis =
        piper.type !== 'PipeExpression'
          ? 'xy'
          : piper?.body?.[1]?.callee?.name === 'rx'
          ? 'xz'
          : 'yz'
      setGuiMode({ mode: 'canEditSketch', pathToNode, axis, quaternion }) // TODO needs fix
      setDidSetCanEdit(true)
    } else if (
      !shouldHighlight &&
      didSetCanEdit &&
      guiMode.mode === 'canEditSketch'
    ) {
      setGuiMode({ mode: 'default' })
      setDidSetCanEdit(false)
    }
  }, [selectionRange, sourceRange])
  return {
    editorCursor,
  }
}

function SketchLine({
  geo,
  sourceRange,
  forceHighlight = false,
}: {
  geo: LineGeos
  sourceRange: [number, number]
  forceHighlight?: boolean
}) {
  const { editorCursor } = useHeightlight(sourceRange)
  const { setHighlightRange } = useStore(
    ({ setHighlightRange, selectionRange, guiMode, setGuiMode, ast }) => ({
      setHighlightRange,
      selectionRange,
      guiMode,
      setGuiMode,
      ast,
    })
  )
  // This reference will give us direct access to the mesh
  const ref = useRef<BufferGeometry | undefined>() as any
  const [hovered, setHover] = useState(false)

  return (
    <>
      <mesh
        ref={ref}
        onPointerOver={(event) => {
          setHover(true)
          setHighlightRange(sourceRange)
        }}
        onPointerOut={(event) => {
          setHover(false)
          setHighlightRange([0, 0])
        }}
      >
        <primitive object={geo.line} />
        <meshStandardMaterial
          color={
            hovered
              ? 'hotpink'
              : editorCursor || forceHighlight
              ? 'skyblue'
              : 'orange'
          }
        />
      </mesh>
      <MovingSphere
        geo={geo.tip}
        sourceRange={sourceRange}
        editorCursor={editorCursor || forceHighlight}
      />
    </>
  )
}

const roundOff = (num: number, places: number): number => {
  const x = Math.pow(10, places)
  return Math.round(num * x) / x
}

function MovingSphere({
  geo,
  sourceRange,
  editorCursor,
}: {
  geo: BufferGeometry
  sourceRange: [number, number]
  editorCursor: boolean
}) {
  const ref = useRef<BufferGeometry | undefined>() as any
  const detectionPlaneRef = useRef<BufferGeometry | undefined>() as any
  const lastPointerRef = useRef<Vector3>(new Vector3())
  const point2DRef = useRef<Vector2>(new Vector2())
  const [hovered, setHover] = useState(false)
  const [isMouseDown, setIsMouseDown] = useState(false)

  const { setHighlightRange, guiMode, ast, updateAst } = useStore((s) => ({
    setHighlightRange: s.setHighlightRange,
    selectionRange: s.selectionRange,
    guiMode: s.guiMode,
    setGuiMode: s.setGuiMode,
    ast: s.ast,
    updateAst: s.updateAst,
  }))
  const { originalXY } = useMemo(() => {
    if (ast) {
      const thePath = getNodePathFromSourceRange(ast, sourceRange)
      const callExpression = getNodeFromPath(ast, thePath) as CallExpression
      const [xArg, yArg] = callExpression?.arguments || []
      const x = xArg?.type === 'Literal' ? xArg.value : -1
      const y = yArg?.type === 'Literal' ? yArg.value : -1
      return {
        originalXY: [x, y],
      }
    }
    return {
      originalXY: [-1, -1],
    }
  }, [ast])

  useEffect(() => {
    const handleMouseUp = () => {
      if (isMouseDown && ast) {
        const thePath = getNodePathFromSourceRange(ast, sourceRange)
        let [x, y] = [
          roundOff(point2DRef.current.x, 2),
          roundOff(point2DRef.current.y, 2),
        ]
        let theNewPoints: [number, number] = [x, y]
        const { modifiedAst } = changeArguments(ast, thePath, theNewPoints)
        updateAst(modifiedAst)
        ref.current.position.set(0, 0, 0)
      }
      setIsMouseDown(false)
    }
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isMouseDown, ast])

  let clickDetectPlaneQuaternion = new Quaternion()
  if (
    guiMode.mode === 'canEditSketch' ||
    (guiMode.mode === 'sketch' && guiMode.sketchMode === 'sketchEdit')
  ) {
    clickDetectPlaneQuaternion = guiMode.quaternion.clone()
  }

  return (
    <>
      <mesh
        ref={ref}
        onPointerOver={(event) => {
          setHover(true)
          setHighlightRange(sourceRange)
        }}
        onPointerOut={(event) => {
          setHover(false)
          setHighlightRange([0, 0])
        }}
        onPointerDown={() => setIsMouseDown(true)}
      >
        <primitive object={geo} scale={hovered ? 2 : 1} />
        <meshStandardMaterial
          color={hovered ? 'hotpink' : editorCursor ? 'skyblue' : 'orange'}
        />
      </mesh>
      {isMouseDown && (
        <mesh
          position={[0, 0, -0.05]}
          quaternion={clickDetectPlaneQuaternion}
          onPointerMove={(a) => {
            const point = a.point

            const transformedPoint = point.clone()
            let inverseQuaternion = new Quaternion()
            if (
              guiMode.mode === 'canEditSketch' ||
              (guiMode.mode === 'sketch' && guiMode.sketchMode === 'sketchEdit')
            ) {
              inverseQuaternion = guiMode.quaternion.clone()
            }
            inverseQuaternion = inverseQuaternion.invert()
            transformedPoint.applyQuaternion(inverseQuaternion)
            point2DRef.current.set(transformedPoint.x, transformedPoint.y)

            if (
              lastPointerRef.current.x === 0 &&
              lastPointerRef.current.y === 0 &&
              lastPointerRef.current.z === 0
            ) {
              lastPointerRef.current.set(point.x, point.y, point.z)
              return
            }
            if (guiMode.mode)
              if (ref.current) {
                const diff = new Vector3().subVectors(
                  point,
                  lastPointerRef.current
                )
                console.log(originalXY)
                if (originalXY[0] === -1) {
                  diff.x = 0
                }
                if (originalXY[1] === -1) {
                  diff.y = 0
                }
                ref.current.position.add(diff)
                lastPointerRef.current.set(point.x, point.y, point.z)
              }
          }}
          name="my-mesh"
        >
          <planeGeometry args={[50, 50]} ref={detectionPlaneRef} />
          <meshStandardMaterial
            side={DoubleSide}
            color="blue"
            transparent
            opacity={0}
          />
        </mesh>
      )}
    </>
  )
}

export function RenderViewerArtifacts({
  artifact,
  forceHighlight = false,
}: {
  artifact: ViewerArtifact
  forceHighlight?: boolean
}) {
  const { selectionRange } = useStore(({ selectionRange }) => ({
    selectionRange,
  }))
  const [editorCursor, setEditorCursor] = useState(false)
  useEffect(() => {
    const shouldHighlight = isOverlapping(artifact.sourceRange, selectionRange)
    setEditorCursor(shouldHighlight)
  }, [selectionRange, artifact.sourceRange])
  if (artifact.type === 'sketchLine') {
    const { geo, sourceRange } = artifact
    return (
      <SketchLine
        geo={geo}
        sourceRange={sourceRange}
        forceHighlight={forceHighlight || editorCursor}
      />
    )
  }
  if (artifact.type === 'sketchBase') {
    console.log('BASE TODO')
    return null
  }
  return (
    <>
      {artifact.children.map((artifact, index) => (
        <RenderViewerArtifacts
          artifact={artifact}
          key={index}
          forceHighlight={forceHighlight || editorCursor}
        />
      ))}
    </>
  )
}
