import { useRef, useState, useEffect, useMemo, Fragment } from 'react'
import {
  CallExpression,
  ArrayExpression,
  PipeExpression,
} from '../lang/abstractSyntaxTree'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
  getNodeFromPathCurry,
} from '../lang/queryAst'
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
import { isOverlap, roundOff } from '../lib/utils'
import { Vector3, DoubleSide, Quaternion } from 'three'
import { useSetCursor } from '../hooks/useSetCursor'
import { getConstraintLevelFromSourceRange } from '../lang/std/sketchcombos'
import { createCallExpression, createPipeSubstitution } from '../lang/modifyAst'
import { getSketchSegmentFromSourceRange } from '../lang/std/sketchConstraints'

function LineEnd({
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
  const baseColor = useConstraintColors(sourceRange)

  const setCursor = useSetCursor(sourceRange, 'line-end')

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
        const current2d = point2DRef.current.clone()
        const inverseQuaternion = new Quaternion()
        if (
          guiMode.mode === 'canEditSketch' ||
          (guiMode.mode === 'sketch' && guiMode.sketchMode === 'sketchEdit')
        ) {
          inverseQuaternion.set(...guiMode.rotation)
          inverseQuaternion.invert()
        }
        current2d.sub(
          new Vector3(...position).applyQuaternion(inverseQuaternion)
        )
        let [x, y] = [roundOff(current2d.x, 2), roundOff(current2d.y, 2)]
        let theNewPoints: [number, number] = [x, y]
        const { modifiedAst } = changeSketchArguments(
          ast,
          programMemory,
          sourceRange,
          theNewPoints,
          guiMode,
          from
        )
        if (!(current2d.x === 0 && current2d.y === 0 && current2d.z === 0))
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
        onPointerDown={() => {
          inEditMode && setIsMouseDown(true)
          setCursor()
        }}
      >
        <primitive object={geo} scale={hovered ? 2 : 1} />
        <meshStandardMaterial
          color={hovered ? 'hotpink' : editorCursor ? 'skyblue' : baseColor}
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

export function RenderViewerArtifacts2() {
  const ids = useSetAppModeFromCursorLocation2()
  const { artifactMap } = useStore((s) => ({
    artifactMap: s.artifactMap,
  }))

  return (
    <>
      {ids.map(({ id, name }) => {
        const artifact = artifactMap[id]

        const _artifact = artifact?.type === 'result' && artifact.data
        if (!_artifact) return null
        return (
          <Fragment key={id}>
            {_artifact.line && (
              <PathRender2
                id={id}
                name={name}
                artifact={_artifact.line}
                type="default"
              />
            )}
            {_artifact.tip && (
              <PathRender2
                id={id}
                name={name}
                artifact={_artifact.tip}
                type="line-end"
              />
            )}
            {_artifact.base && (
              <PathRender2
                id={id}
                name={name}
                artifact={_artifact.base}
                type="default"
              />
            )}
          </Fragment>
        )
      })}
    </>
  )
}

function PathRender2({
  id,
  artifact,
  type,
  name,
}: {
  id: string
  name: string
  artifact: any
  type?: 'default' | 'line-end' | 'line-mid'
}) {
  const { setHighlightRange, sourceRangeMap, selectionRanges, programMemory } =
    useStore((s) => ({
      setHighlightRange: s.setHighlightRange,
      sourceRangeMap: s.sourceRangeMap,
      selectionRanges: s.selectionRanges,
      programMemory: s.programMemory,
    }))
  const sourceRange = sourceRangeMap[id] || [0, 0]
  const onClick = useSetCursor(sourceRange, type)
  // This reference will give us direct access to the mesh
  const ref = useRef<BufferGeometry | undefined>() as any
  const [hovered, setHover] = useState(false)

  const baseColor = useConstraintColors(sourceRange)

  const [editorCursor, setEditorCursor] = useState(false)
  const [editorLineCursor, setEditorLineCursor] = useState(false)
  useEffect(() => {
    const shouldHighlight = selectionRanges.codeBasedSelections.some(
      ({ range }) => isOverlap(sourceRange, range)
    )
    const shouldHighlightLine = selectionRanges.codeBasedSelections.some(
      ({ range, type }) => isOverlap(sourceRange, range) && type === 'default'
    )
    setEditorCursor(shouldHighlight)
    setEditorLineCursor(shouldHighlightLine)
  }, [selectionRanges, sourceRange])

  const forcer = type === 'line-end' ? editorCursor : editorLineCursor

  const sketchOrExtrudeGroup = programMemory?.root?.[name] as SketchGroup
  if (type === 'line-end') {
    console.log(artifact)
    const { segment } = getSketchSegmentFromSourceRange(
      sketchOrExtrudeGroup,
      sourceRange
    )
    return (
      <LineEnd
        geo={artifact}
        from={segment.from}
        sourceRange={sourceRange}
        editorCursor={editorCursor}
        rotation={sketchOrExtrudeGroup.rotation}
        position={sketchOrExtrudeGroup.position}
      />
    )
  }

  return (
    <>
      <mesh
        quaternion={sketchOrExtrudeGroup.rotation}
        position={sketchOrExtrudeGroup.position}
        ref={ref}
        onPointerOver={(e) => {
          setHover(true)
          setHighlightRange(sourceRange)
        }}
        onPointerOut={(e) => {
          setHover(false)
          setHighlightRange([0, 0])
        }}
        onClick={() => {
          // _onClick()
          onClick()
        }}
      >
        <primitive object={artifact} />
        <meshStandardMaterial
          color={hovered ? 'hotpink' : forcer ? 'skyblue' : baseColor}
        />
      </mesh>
    </>
  )
}

function RenderViewerArtifact({
  artifact,
}: {
  artifact: ExtrudeGroup | SketchGroup
}) {
  if (artifact.type === 'sketchGroup') {
    return (
      <>
        {artifact.start && (
          <PathRender
            geoInfo={artifact.start}
            forceHighlight={false}
            rotation={artifact.rotation}
            position={artifact.position}
          />
        )}
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
  const { setHighlightRange, selectionRanges } = useStore(
    ({ setHighlightRange, selectionRanges }) => ({
      setHighlightRange,
      selectionRanges,
    })
  )
  const onClick = useSetCursor(geoInfo.__geoMeta.sourceRange)
  // This reference will give us direct access to the mesh
  const ref = useRef<BufferGeometry | undefined>() as any
  const [hovered, setHover] = useState(false)

  const [editorCursor, setEditorCursor] = useState(false)
  useEffect(() => {
    const shouldHighlight = selectionRanges.codeBasedSelections.some(
      ({ range }) => isOverlap(geoInfo.__geoMeta.sourceRange, range)
    )
    setEditorCursor(shouldHighlight)
  }, [selectionRanges, geoInfo])

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
  const { selectionRanges, updateAstAsync, ast, guiMode } = useStore((s) => ({
    selectionRanges: s.selectionRanges,
    updateAstAsync: s.updateAstAsync,
    ast: s.ast,
    guiMode: s.guiMode,
  }))
  const [editorCursor, setEditorCursor] = useState(false)
  const [editorLineCursor, setEditorLineCursor] = useState(false)
  useEffect(() => {
    const shouldHighlight = selectionRanges.codeBasedSelections.some(
      ({ range }) => isOverlap(geoInfo.__geoMeta.sourceRange, range)
    )
    const shouldHighlightLine = selectionRanges.codeBasedSelections.some(
      ({ range, type }) =>
        isOverlap(geoInfo.__geoMeta.sourceRange, range) && type === 'default'
    )
    setEditorCursor(shouldHighlight)
    setEditorLineCursor(shouldHighlightLine)
  }, [selectionRanges, geoInfo])
  return (
    <>
      {geoInfo.__geoMeta.geos.map((meta, i) => {
        if (meta.type === 'line')
          return (
            <LineRender
              key={i}
              geo={meta.geo}
              sourceRange={geoInfo.__geoMeta.sourceRange}
              forceHighlight={editorLineCursor}
              rotation={rotation}
              position={position}
            />
          )
        if (meta.type === 'lineEnd')
          return (
            <LineEnd
              key={i}
              geo={meta.geo}
              from={geoInfo.from}
              sourceRange={geoInfo.__geoMeta.sourceRange}
              editorCursor={forceHighlight || editorCursor}
              rotation={rotation}
              position={position}
            />
          )
        if (meta.type === 'sketchBase')
          return (
            <LineRender
              key={i}
              geo={meta.geo}
              sourceRange={geoInfo.__geoMeta.sourceRange}
              forceHighlight={forceHighlight || editorLineCursor}
              rotation={rotation}
              position={position}
              onClick={() => {
                if (
                  !ast ||
                  !(guiMode.mode === 'sketch' && guiMode.sketchMode === 'line')
                )
                  return
                const path = getNodePathFromSourceRange(
                  ast,
                  geoInfo.__geoMeta.sourceRange
                )
                const getNode = getNodeFromPathCurry(ast, path)
                const maybeStartSketchAt =
                  getNode<CallExpression>('CallExpression')
                const pipe = getNode<PipeExpression>('PipeExpression')
                if (
                  maybeStartSketchAt?.node.callee.name === 'startSketchAt' &&
                  pipe.node &&
                  pipe.node.body.length > 2
                ) {
                  const modifiedAst = JSON.parse(JSON.stringify(ast))
                  const _pipe = getNodeFromPath<PipeExpression>(
                    modifiedAst,
                    path,
                    'PipeExpression'
                  )
                  _pipe.node.body.push(
                    createCallExpression('close', [createPipeSubstitution()])
                  )
                  updateAstAsync(modifiedAst)
                }
              }}
            />
          )
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
  onClick: _onClick = () => {},
}: {
  geo: BufferGeometry
  sourceRange: [number, number]
  forceHighlight?: boolean
  rotation: Rotation
  position: Position
  onClick?: () => void
}) {
  const { setHighlightRange } = useStore((s) => ({
    setHighlightRange: s.setHighlightRange,
  }))
  const onClick = useSetCursor(sourceRange)
  // This reference will give us direct access to the mesh
  const ref = useRef<BufferGeometry | undefined>() as any
  const [hovered, setHover] = useState(false)

  const baseColor = useConstraintColors(sourceRange)

  return (
    <>
      <mesh
        quaternion={rotation}
        position={position}
        ref={ref}
        onPointerOver={(e) => {
          setHover(true)
          setHighlightRange(sourceRange)
        }}
        onPointerOut={(e) => {
          setHover(false)
          setHighlightRange([0, 0])
        }}
        onClick={() => {
          _onClick()
          onClick()
        }}
      >
        <primitive object={geo} />
        <meshStandardMaterial
          color={hovered ? 'hotpink' : forceHighlight ? 'skyblue' : baseColor}
        />
      </mesh>
    </>
  )
}

type Artifact = ExtrudeGroup | SketchGroup

type IdAndName = { id: string; name: string }

function useSetAppModeFromCursorLocation2(): IdAndName[] {
  const [ids, setIds] = useState<IdAndName[]>([])
  const {
    selectionRanges,
    guiMode,
    setGuiMode,
    ast,
    sourceRangeMap,
    programMemory,
  } = useStore((s) => ({
    selectionRanges: s.selectionRanges,
    guiMode: s.guiMode,
    setGuiMode: s.setGuiMode,
    ast: s.ast,
    sourceRangeMap: s.sourceRangeMap,
    programMemory: s.programMemory,
  }))
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
    const _ids: IdAndName[] = []
    programMemory?.return?.forEach(({ name }: { name: string }) => {
      const artifact = programMemory?.root?.[name]
      if (artifact.type === 'extrudeGroup' || artifact.type === 'sketchGroup') {
        let hasOverlap: Path | ExtrudeSurface | false = false
        artifact?.value?.forEach((path) => {
          const id = path.__geoMeta.id
          _ids.push({ id, name })
          const sourceRange = sourceRangeMap[id]
          if (
            isOverlap(sourceRange, selectionRanges.codeBasedSelections[0].range)
          ) {
            hasOverlap = path
          }
        })
        if (hasOverlap) {
          const _hasOverlap = hasOverlap as Path | ExtrudeSurface
          artifactsWithinCursorRange.push({
            parentType: artifact.type,
            isParent: false,
            pathToNode: _hasOverlap.__geoMeta.pathToNode,
            sourceRange: _hasOverlap.__geoMeta.sourceRange,
            rotation: artifact.rotation,
            position: artifact.position,
          })
        }
        artifact.__meta.forEach((meta) => {
          if (
            isOverlap(
              meta.sourceRange,
              selectionRanges.codeBasedSelections[0].range
            )
          ) {
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
      }
    })

    setIds(_ids)

    const parentArtifacts = artifactsWithinCursorRange.filter((a) => a.isParent)
    const hasSketchArtifact = artifactsWithinCursorRange.filter(
      ({ parentType }) => parentType === 'sketchGroup'
    )
    const hasExtrudeArtifact = artifactsWithinCursorRange.filter(
      ({ parentType }) => parentType === 'extrudeGroup'
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
      hasExtrudeArtifact.length &&
      (guiMode.mode === 'default' || guiMode.mode === 'canEditExtrude') &&
      ast
    ) {
      const pathToNode = getNodePathFromSourceRange(
        ast,
        hasExtrudeArtifact[0].sourceRange
      )
      const { rotation, position } = hasExtrudeArtifact[0]
      setGuiMode({ mode: 'canEditExtrude', pathToNode, rotation, position })
    } else if (
      !shouldHighlight &&
      (guiMode.mode === 'canEditExtrude' || guiMode.mode === 'canEditSketch')
    ) {
      setGuiMode({ mode: 'default' })
    }
  }, [programMemory, selectionRanges])
  return ids
}
function useSetAppModeFromCursorLocation(artifacts: Artifact[]) {
  const { selectionRanges, guiMode, setGuiMode, ast } = useStore(
    ({ selectionRanges, guiMode, setGuiMode, ast }) => ({
      selectionRanges,
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
        if (
          isOverlap(
            geo.__geoMeta.sourceRange,
            selectionRanges.codeBasedSelections[0].range
          )
        ) {
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
        if (
          isOverlap(
            meta.sourceRange,
            selectionRanges.codeBasedSelections[0].range
          )
        ) {
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
    const hasExtrudeArtifact = artifactsWithinCursorRange.filter(
      ({ parentType }) => parentType === 'extrudeGroup'
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
      hasExtrudeArtifact.length &&
      (guiMode.mode === 'default' || guiMode.mode === 'canEditExtrude') &&
      ast
    ) {
      const pathToNode = getNodePathFromSourceRange(
        ast,
        hasExtrudeArtifact[0].sourceRange
      )
      const { rotation, position } = hasExtrudeArtifact[0]
      setGuiMode({ mode: 'canEditExtrude', pathToNode, rotation, position })
    } else if (
      !shouldHighlight &&
      (guiMode.mode === 'canEditExtrude' || guiMode.mode === 'canEditSketch')
    ) {
      setGuiMode({ mode: 'default' })
    }
  }, [artifacts, selectionRanges])
}

function useConstraintColors(sourceRange: [number, number]): string {
  const { guiMode, ast } = useStore((s) => ({
    guiMode: s.guiMode,
    ast: s.ast,
  }))
  const [baseColor, setBaseColor] = useState('orange')
  useEffect(() => {
    if (!ast || guiMode.mode !== 'sketch') {
      setBaseColor('orange')
      return
    }
    try {
      const level = getConstraintLevelFromSourceRange(sourceRange, ast)
      if (level === 'free') {
        setBaseColor('orange')
      } else if (level === 'partial') {
        setBaseColor('IndianRed')
      } else if (level === 'full') {
        setBaseColor('lightgreen')
      }
    } catch (e) {
      setBaseColor('orange')
    }
  }, [guiMode, ast, sourceRange])

  return baseColor
}
