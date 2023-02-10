import { useRef, useState, useEffect, useMemo } from 'react'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
  CallExpression,
  ArrayExpression,
} from '../lang/abstractSyntaxTree'
import { changeSketchArguments } from '../lang/std/sketch'
import {
  ExtrudeGroup,
  ExtrudeSurface,
  SketchGroup,
  Path,
  Rotation,
  Position,
  PathToNode,
  SourceRange,
} from '../lang/executor'
import { BufferGeometry } from 'three'
import { useStore } from '../useStore'
import { isOverlap } from '../lib/utils'
import { Vector3, DoubleSide, Quaternion } from 'three'
import { useSetCursor } from '../hooks/useSetCursor'
import { roundOff } from '../lib/utils'

function MovingSphere({
  geo,
  sourceRange,
  editorCursor,
  rotation,
  position,
  from,
}: {
  geo: BufferGeometry
  sourceRange: [number, number]
  editorCursor: boolean
  rotation: Rotation
  position: Position
  from: [number, number]
}) {
  const ref = useRef<BufferGeometry | undefined>() as any
  const detectionPlaneRef = useRef<BufferGeometry | undefined>() as any
  const lastPointerRef = useRef<Vector3>(new Vector3())
  const point2DRef = useRef<Vector3>(new Vector3())
  const [hovered, setHover] = useState(false)
  const [isMouseDown, setIsMouseDown] = useState(false)

  const { setHighlightRange, guiMode, ast, updateAst, programMemory } =
    useStore((s) => ({
      setHighlightRange: s.setHighlightRange,
      guiMode: s.guiMode,
      ast: s.ast,
      updateAst: s.updateAst,
      programMemory: s.programMemory,
    }))
  const { originalXY } = useMemo(() => {
    if (ast) {
      const thePath = getNodePathFromSourceRange(ast, sourceRange)
      const { node: callExpression } = getNodeFromPath<CallExpression>(
        ast,
        thePath
      )
      const [xArg, yArg] =
        guiMode.mode === 'sketch'
          ? callExpression?.arguments || []
          : (callExpression?.arguments?.[0] as ArrayExpression)?.elements || []
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
        const yo = point2DRef.current.clone()
        const inverseQuaternion = new Quaternion()
        if (
          guiMode.mode === 'canEditSketch' ||
          (guiMode.mode === 'sketch' && guiMode.sketchMode === 'sketchEdit')
        ) {
          inverseQuaternion.set(...guiMode.rotation)
          inverseQuaternion.invert()
        }
        yo.sub(new Vector3(...position).applyQuaternion(inverseQuaternion))
        let [x, y] = [roundOff(yo.x, 2), roundOff(yo.y, 2)]
        let theNewPoints: [number, number] = [x, y]
        const { modifiedAst } = changeSketchArguments(
          ast,
          programMemory,
          sourceRange,
          theNewPoints,
          guiMode,
          from
        )

        updateAst(modifiedAst)
        ref.current.position.set(...position)
      }
      setIsMouseDown(false)
    }
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isMouseDown])

  const inEditMode =
    guiMode.mode === 'canEditSketch' ||
    (guiMode.mode === 'sketch' && guiMode.sketchMode === 'sketchEdit')

  let clickDetectPlaneQuaternion = new Quaternion()
  if (inEditMode) {
    clickDetectPlaneQuaternion = new Quaternion(...rotation)
  }

  return (
    <>
      <mesh
        position={position}
        quaternion={rotation}
        ref={ref}
        onPointerOver={(event) => {
          inEditMode && setHover(true)
          setHighlightRange(sourceRange)
        }}
        onPointerOut={(event) => {
          setHover(false)
          setHighlightRange([0, 0])
        }}
        onPointerDown={() => inEditMode && setIsMouseDown(true)}
      >
        <primitive object={geo} scale={hovered ? 2 : 1} />
        <meshStandardMaterial
          color={hovered ? 'hotpink' : editorCursor ? 'skyblue' : 'orange'}
        />
      </mesh>
      {isMouseDown && (
        <mesh
          quaternion={clickDetectPlaneQuaternion}
          onPointerMove={(a) => {
            const point = a.point

            const transformedPoint = point.clone()
            const inverseQuaternion = new Quaternion()
            if (
              guiMode.mode === 'canEditSketch' ||
              (guiMode.mode === 'sketch' && guiMode.sketchMode === 'sketchEdit')
            ) {
              inverseQuaternion.set(...guiMode.rotation)
              inverseQuaternion.invert()
            }
            transformedPoint.applyQuaternion(inverseQuaternion)
            point2DRef.current.copy(transformedPoint)

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
                lastPointerRef.current.copy(point.clone())
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
  artifacts,
}: {
  artifacts: (ExtrudeGroup | SketchGroup)[]
}) {
  useSetAppModeFromCursorLocation(artifacts)
  return (
    <>
      {artifacts?.map((artifact, i) => (
        <RenderViewerArtifact key={i} artifact={artifact} />
      ))}
    </>
  )
}

function RenderViewerArtifact({
  artifact,
}: {
  artifact: ExtrudeGroup | SketchGroup
}) {
  // const { selectionRange, guiMode, ast, setGuiMode } = useStore(
  //   ({ selectionRange, guiMode, ast, setGuiMode }) => ({
  //     selectionRange,
  //     guiMode,
  //     ast,
  //     setGuiMode,
  //   })
  // )
  // const [editorCursor, setEditorCursor] = useState(false)
  // useEffect(() => {
  //   const shouldHighlight = isOverlapping(
  //     artifact.__meta.slice(-1)[0].sourceRange,
  //     selectionRange
  //   )
  //   setEditorCursor(shouldHighlight)
  // }, [selectionRange, artifact.__meta])

  if (artifact.type === 'sketchGroup') {
    return (
      <>
        {artifact.value.map((geoInfo, key) => (
          <PathRender
            geoInfo={geoInfo}
            key={key}
            forceHighlight={false}
            rotation={artifact.rotation}
            position={artifact.position}
          />
        ))}
      </>
    )
  }
  if (artifact.type === 'extrudeGroup') {
    return (
      <>
        {artifact.value.map((geoInfo, key) => (
          <WallRender
            geoInfo={geoInfo}
            key={key}
            forceHighlight={false}
            rotation={artifact.rotation}
            position={artifact.position}
          />
        ))}
      </>
    )
  }
  return null
}

function WallRender({
  geoInfo,
  forceHighlight = false,
  rotation,
  position,
}: {
  geoInfo: ExtrudeSurface
  forceHighlight?: boolean
  rotation: Rotation
  position: Position
}) {
  const { setHighlightRange, selectionRange } = useStore(
    ({ setHighlightRange, selectionRange }) => ({
      setHighlightRange,
      selectionRange,
    })
  )
  const onClick = useSetCursor(geoInfo.__geoMeta.sourceRange)
  // This reference will give us direct access to the mesh
  const ref = useRef<BufferGeometry | undefined>() as any
  const [hovered, setHover] = useState(false)

  const [editorCursor, setEditorCursor] = useState(false)
  useEffect(() => {
    const shouldHighlight = isOverlap(
      geoInfo.__geoMeta.sourceRange,
      selectionRange
    )
    setEditorCursor(shouldHighlight)
  }, [selectionRange, geoInfo])

  return (
    <>
      <mesh
        quaternion={rotation}
        position={position}
        ref={ref}
        onPointerOver={(event) => {
          setHover(true)
          setHighlightRange(geoInfo.__geoMeta.sourceRange)
        }}
        onPointerOut={(event) => {
          setHover(false)
          setHighlightRange([0, 0])
        }}
        onClick={onClick}
      >
        <primitive object={geoInfo.__geoMeta.geo} />
        <meshStandardMaterial
          side={DoubleSide}
          color={
            hovered
              ? 'hotpink'
              : forceHighlight || editorCursor
              ? 'skyblue'
              : 'orange'
          }
        />
      </mesh>
    </>
  )
}

function PathRender({
  geoInfo,
  forceHighlight = false,
  rotation,
  position,
}: {
  geoInfo: Path
  forceHighlight?: boolean
  rotation: Rotation
  position: Position
}) {
  const { selectionRange } = useStore(({ selectionRange }) => ({
    selectionRange,
  }))
  const [editorCursor, setEditorCursor] = useState(false)
  useEffect(() => {
    const shouldHighlight = isOverlap(
      geoInfo.__geoMeta.sourceRange,
      selectionRange
    )
    setEditorCursor(shouldHighlight)
  }, [selectionRange, geoInfo])
  return (
    <>
      {geoInfo.__geoMeta.geos.map((meta, i) => {
        if (meta.type === 'line') {
          return (
            <LineRender
              key={i}
              geo={meta.geo}
              sourceRange={geoInfo.__geoMeta.sourceRange}
              forceHighlight={forceHighlight || editorCursor}
              rotation={rotation}
              position={position}
            />
          )
        }
        if (meta.type === 'lineEnd') {
          return (
            <MovingSphere
              key={i}
              geo={meta.geo}
              from={geoInfo.from}
              sourceRange={geoInfo.__geoMeta.sourceRange}
              editorCursor={forceHighlight || editorCursor}
              rotation={rotation}
              position={position}
            />
          )
        }
      })}
    </>
  )
}

function LineRender({
  geo,
  sourceRange,
  forceHighlight = false,
  rotation,
  position,
}: {
  geo: BufferGeometry
  sourceRange: [number, number]
  forceHighlight?: boolean
  rotation: Rotation
  position: Position
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
        quaternion={rotation}
        position={position}
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
          color={hovered ? 'hotpink' : forceHighlight ? 'skyblue' : 'orange'}
        />
      </mesh>
    </>
  )
}

type Artifact = ExtrudeGroup | SketchGroup

function useSetAppModeFromCursorLocation(artifacts: Artifact[]) {
  const { selectionRange, guiMode, setGuiMode, ast } = useStore(
    ({ selectionRange, guiMode, setGuiMode, ast }) => ({
      selectionRange,
      guiMode,
      setGuiMode,
      ast,
    })
  )
  useEffect(() => {
    const artifactsWithinCursorRange: (
      | {
          parentType: Artifact['type']
          isParent: true
          pathToNode: PathToNode
          sourceRange: SourceRange
          rotation: Rotation
          position: Position
        }
      | {
          parentType: Artifact['type']
          isParent: false
          pathToNode: PathToNode
          sourceRange: SourceRange
          rotation: Rotation
          position: Position
        }
    )[] = []
    artifacts?.forEach((artifact) => {
      artifact.value.forEach((geo) => {
        if (isOverlap(geo.__geoMeta.sourceRange, selectionRange)) {
          artifactsWithinCursorRange.push({
            parentType: artifact.type,
            isParent: false,
            pathToNode: geo.__geoMeta.pathToNode,
            sourceRange: geo.__geoMeta.sourceRange,
            rotation: artifact.rotation,
            position: artifact.position,
          })
        }
      })
      artifact.__meta.forEach((meta) => {
        if (isOverlap(meta.sourceRange, selectionRange)) {
          artifactsWithinCursorRange.push({
            parentType: artifact.type,
            isParent: true,
            pathToNode: meta.pathToNode,
            sourceRange: meta.sourceRange,
            rotation: artifact.rotation,
            position: artifact.position,
          })
        }
      })
    })
    const parentArtifacts = artifactsWithinCursorRange.filter((a) => a.isParent)
    const hasSketchArtifact = artifactsWithinCursorRange.filter(
      ({ parentType }) => parentType === 'sketchGroup'
    )
    const artifact = parentArtifacts[0]
    const shouldHighlight = !!artifact || hasSketchArtifact.length
    if (
      (guiMode.mode === 'default' || guiMode.mode === 'canEditSketch') &&
      ast &&
      hasSketchArtifact.length
    ) {
      const pathToNode = getNodePathFromSourceRange(
        ast,
        hasSketchArtifact[0].sourceRange
      )
      const { rotation, position } = hasSketchArtifact[0]
      setGuiMode({ mode: 'canEditSketch', pathToNode, rotation, position })
    } else if (
      !shouldHighlight &&
      (guiMode.mode === 'canEditExtrude' || guiMode.mode === 'canEditSketch')
    ) {
      setGuiMode({ mode: 'default' })
    }
  }, [artifacts, selectionRange])
}
