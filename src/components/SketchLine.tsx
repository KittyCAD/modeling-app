import { useRef, useState, useEffect, useMemo } from 'react'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
  CallExpression,
  VariableDeclarator,
} from '../lang/abstractSyntaxTree'
import { changeArguments } from '../lang/modifyAst'
import { ViewerArtifact } from '../lang/executor'
import { BufferGeometry } from 'three'
import { useStore } from '../useStore'
import { isOverlapping } from '../lib/utils'
import { LineGeos } from '../lang/engine'
import { Vector3, DoubleSide, Quaternion, Vector2 } from 'three'
import { combineTransformsAlt } from '../lang/sketch'
import { useSetCursor } from '../hooks/useSetCursor'

function SketchLine({
  geo,
  sourceRange,
  forceHighlight = false,
}: {
  geo: LineGeos
  sourceRange: [number, number]
  forceHighlight?: boolean
}) {
  const { setHighlightRange } = useStore(({ setHighlightRange }) => ({
    setHighlightRange,
  }))
  const onClick = useSetCursor(sourceRange)
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
        onClick={onClick}
      >
        <primitive object={geo.line} />
        <meshStandardMaterial
          color={hovered ? 'hotpink' : forceHighlight ? 'skyblue' : 'orange'}
        />
      </mesh>
      <MovingSphere
        geo={geo.tip}
        sourceRange={sourceRange}
        editorCursor={forceHighlight}
      />
    </>
  )
}

function ExtrudeWall({
  geo,
  sourceRange,
  forceHighlight = false,
}: {
  geo: BufferGeometry
  sourceRange: [number, number]
  forceHighlight?: boolean
}) {
  const { setHighlightRange } = useStore(
    ({ setHighlightRange, selectionRange, guiMode, setGuiMode, ast }) => ({
      setHighlightRange,
      selectionRange,
      guiMode,
      setGuiMode,
      ast,
    })
  )
  const onClick = useSetCursor(sourceRange)
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
        onClick={onClick}
      >
        <primitive object={geo} />
        <meshStandardMaterial
          side={DoubleSide}
          color={hovered ? 'hotpink' : forceHighlight ? 'skyblue' : 'orange'}
        />
      </mesh>
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
    guiMode: s.guiMode,
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
  let position = new Vector3(0, 0, 0)
  if (
    guiMode.mode === 'canEditSketch' ||
    (guiMode.mode === 'sketch' && guiMode.sketchMode === 'sketchEdit')
  ) {
    clickDetectPlaneQuaternion = guiMode.quaternion.clone()
    position = new Vector3(...guiMode.position)
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
          position={position}
          quaternion={clickDetectPlaneQuaternion}
          onPointerMove={(a) => {
            const point = a.point

            const transformedPoint = point.clone()
            const inverseQuaternion = new Quaternion()
            if (
              guiMode.mode === 'canEditSketch' ||
              (guiMode.mode === 'sketch' && guiMode.sketchMode === 'sketchEdit')
            ) {
              inverseQuaternion.copy(guiMode.quaternion.clone().invert())
            }
            transformedPoint.applyQuaternion(inverseQuaternion)
            transformedPoint.sub(
              position.clone().applyQuaternion(inverseQuaternion)
            )
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
                  point.clone().applyQuaternion(inverseQuaternion),
                  lastPointerRef.current
                    .clone()
                    .applyQuaternion(inverseQuaternion)
                )
                if (originalXY[0] === -1) {
                  // x arg is not a literal and should be locked
                  diff.x = 0
                }
                if (originalXY[1] === -1) {
                  // y arg is not a literal and should be locked
                  diff.y = 0
                }
                ref.current.position.add(
                  diff.applyQuaternion(inverseQuaternion.invert())
                )
                lastPointerRef.current.set(point.x, point.y, point.z)
              }
          }}
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
  const { selectionRange, guiMode, ast, setGuiMode, programMemory } = useStore(
    ({ selectionRange, guiMode, ast, setGuiMode, programMemory }) => ({
      selectionRange,
      guiMode,
      ast,
      setGuiMode,
      programMemory,
    })
  )
  const [editorCursor, setEditorCursor] = useState(false)
  useEffect(() => {
    const shouldHighlight = isOverlapping(artifact.sourceRange, selectionRange)
    setEditorCursor(shouldHighlight && artifact.type !== 'sketch')
  }, [selectionRange, artifact.sourceRange])

  useEffect(() => {
    const shouldHighlight = isOverlapping(artifact.sourceRange, selectionRange)
    if (
      shouldHighlight &&
      (guiMode.mode === 'default' || guiMode.mode === 'canEditSketch') &&
      artifact.type === 'sketch' &&
      ast
    ) {
      const pathToNode = getNodePathFromSourceRange(ast, artifact.sourceRange)
      const varDec: VariableDeclarator = getNodeFromPath(
        ast,
        pathToNode,
        'VariableDeclarator'
      )
      const varName = varDec?.id?.name
      const { quaternion, position } = combineTransformsAlt(
        programMemory.root[varName]
      )
      setGuiMode({ mode: 'canEditSketch', pathToNode, quaternion, position })
    } else if (
      !shouldHighlight &&
      guiMode.mode === 'canEditSketch' &&
      artifact.type === 'sketch'
    ) {
      setGuiMode({ mode: 'default' })
    }
  }, [selectionRange, artifact.sourceRange, ast, guiMode.mode, setGuiMode])
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
  if (artifact.type === 'extrudeWall') {
    return (
      <ExtrudeWall
        geo={artifact.geo}
        sourceRange={artifact.sourceRange}
        forceHighlight={forceHighlight || editorCursor}
      />
    )
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
