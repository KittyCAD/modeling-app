import { useRef, useState, useEffect, useMemo, Fragment } from 'react'
import { CallExpression, ArrayExpression } from '../lang/abstractSyntaxTree'
import { getNodePathFromSourceRange, getNodeFromPath } from '../lang/queryAst'
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
import { getSketchSegmentFromSourceRange } from '../lang/std/sketchConstraints'

function LineEnd({
  geo,
  sourceRange,
  editorCursor,
  id,
  rotation,
  position,
  from,
}: {
  geo: BufferGeometry
  sourceRange: [number, number]
  id: string
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

  const setCursor2 = useSetCursor(id, 'line-end')

  const { guiMode, ast, updateAst, programMemory, engineCommandManager } =
    useStore((s) => ({
      guiMode: s.guiMode,
      ast: s.ast,
      updateAst: s.updateAst,
      programMemory: s.programMemory,
      engineCommandManager: s.engineCommandManager,
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
          engineCommandManager.hover(id)
        }}
        onPointerOut={(event) => {
          setHover(false)
          engineCommandManager.hover()
        }}
        onPointerDown={() => {
          inEditMode && setIsMouseDown(true)
          setCursor2()
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

export function RenderViewerArtifacts() {
  const ids = useSetAppModeFromCursorLocation()
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
              <PathRender
                id={id}
                name={name}
                artifact={_artifact.line}
                type="default"
              />
            )}
            {_artifact.tip && (
              <PathRender
                id={id}
                name={name}
                artifact={_artifact.tip}
                type="line-end"
              />
            )}
            {_artifact.base && (
              <PathRender
                id={id}
                name={name}
                artifact={_artifact.base}
                type="default"
              />
            )}
            {_artifact.geo && (
              <PathRender
                id={_artifact.originalId}
                name={name}
                artifact={_artifact.geo}
                type="default"
              />
            )}
          </Fragment>
        )
      })}
    </>
  )
}

function PathRender({
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
  const {
    sourceRangeMap,
    selectionRanges,
    programMemory,
    engineCommandManager,
  } = useStore((s) => ({
    sourceRangeMap: s.sourceRangeMap,
    selectionRanges: s.selectionRanges,
    programMemory: s.programMemory,
    engineCommandManager: s.engineCommandManager,
  }))
  const sourceRange = sourceRangeMap[id] || [0, 0]
  const onClick2 = useSetCursor(id, type)
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
    try {
      const { segment } = getSketchSegmentFromSourceRange(
        sketchOrExtrudeGroup,
        sourceRange
      )
      return (
        <LineEnd
          geo={artifact}
          from={segment.from}
          id={id}
          sourceRange={sourceRange}
          editorCursor={editorCursor}
          rotation={sketchOrExtrudeGroup.rotation}
          position={sketchOrExtrudeGroup.position}
        />
      )
    } catch (e) {}
  }

  return (
    <>
      <mesh
        quaternion={sketchOrExtrudeGroup.rotation}
        position={sketchOrExtrudeGroup.position}
        ref={ref}
        onPointerOver={(e) => {
          setHover(true)
          engineCommandManager.hover(id)
        }}
        onPointerOut={(e) => {
          setHover(false)
          engineCommandManager.hover()
        }}
        onClick={() => {
          // _onClick()
          onClick2()
        }}
      >
        <primitive object={artifact} />
        <meshStandardMaterial
          color={hovered ? 'hotpink' : forcer ? 'skyblue' : baseColor}
          side={DoubleSide}
        />
      </mesh>
    </>
  )
}

type Artifact = ExtrudeGroup | SketchGroup

type IdAndName = { id: string; name: string }

function useSetAppModeFromCursorLocation(): IdAndName[] {
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
          const refSourceRange = sourceRangeMap[(path?.__geoMeta as any)?.refId]
          if (
            isOverlap(sourceRange, selectionRanges.codeBasedSelections[0].range)
          ) {
            hasOverlap = path
          }
          if (
            refSourceRange &&
            isOverlap(
              refSourceRange,
              selectionRanges.codeBasedSelections[0].range
            )
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
