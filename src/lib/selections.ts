import type { SelectionRange } from '@codemirror/state'
import { EditorSelection } from '@codemirror/state'
import type { WebSocketRequest } from '@kittycad/lib'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import type { Object3D } from 'three'
import { Mesh } from 'three'

import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  EXTRA_SEGMENT_HANDLE,
  SEGMENT_BLUE,
  SEGMENT_BODIES_PLUS_PROFILE_START,
  getParentGroup,
} from '@src/clientSideScene/sceneConstants'
import { AXIS_GROUP, X_AXIS } from '@src/clientSideScene/sceneUtils'
import {
  findAllChildrenAndOrderByPlaceInCode,
  getEdgeCutMeta,
  getLastVariable,
  getNodeFromPath,
  isSingleCursorInPipe,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { defaultSourceRange } from '@src/lang/sourceRange'
import type { Artifact, ArtifactId } from '@src/lang/std/artifactGraph'

import type { CodeRef } from '@src/lang/std/artifactGraph'
import {
  getCapCodeRef,
  getCodeRefsByArtifactId,
  getSweepFromSuspectedSweepSurface,
  getWallCodeRef,
  getArtifactOfTypes,
  getSolid2dCodeRef,
} from '@src/lang/std/artifactGraph'
import type { PathToNodeMap } from '@src/lang/util'
import { isCursorInSketchCommandRange, topLevelRange } from '@src/lang/util'
import { isArray } from '@src/lib/utils'
import type {
  ArtifactGraph,
  CallExpressionKw,
  ExecState,
  Expr,
  Program,
  SourceRange,
} from '@src/lang/wasm'
import type { EntityReference } from '@src/machines/modelingSharedTypes'
import type { ArtifactEntry, ArtifactIndex } from '@src/lib/artifactIndex'
import type { CommandArgument } from '@src/lib/commandTypes'
import type { DefaultPlaneStr } from '@src/lib/planes'
import type RustContext from '@src/lib/rustContext'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type { ConnectionManager } from '@src/network/connectionManager'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { err } from '@src/lib/trap'
import {
  getNormalisedCoordinates,
  isArray,
  isNonNullable,
  isOverlap,
  uuidv4,
} from '@src/lib/utils'
import type { ModelingMachineEvent } from '@src/machines/modelingMachine'
import type {
  DefaultPlane,
  ExtrudeFacePlane,
  OffsetPlane,
} from '@src/machines/modelingSharedTypes'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import toast from 'react-hot-toast'
import { showSketchOnImportToast } from '@src/components/SketchOnImportToast'
import type {
  Selection,
  SelectionV2,
  Selections,
} from '@src/machines/modelingSharedTypes'
import { artifactToEntityRef, resolveSelectionV2 } from '@src/lang/queryAst'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ImportStatement } from '@rust/kcl-lib/bindings/ImportStatement'

export const X_AXIS_UUID = 'ad792545-7fd3-482a-a602-a93924e3055b'
export const Y_AXIS_UUID = '680fd157-266f-4b8a-984f-cdf46b8bdf01'

export function normalizeEntityReference(
  reference: unknown
): EntityReference | null {
  if (!reference || typeof reference !== 'object') return null

  const raw = reference as Record<string, unknown>
  const type = raw.type
  if (typeof type !== 'string') return null

  if (type === 'plane') {
    const plane_id = raw.plane_id ?? raw.planeId
    if (typeof plane_id !== 'string') return null
    return { type: 'plane', plane_id }
  }

  if (type === 'face') {
    const face_id = raw.face_id ?? raw.faceId
    if (typeof face_id !== 'string') return null
    return { type: 'face', face_id }
  }

  if (type === 'solid2d') {
    const solid2d_id = raw.solid2d_id ?? raw.solid2dId
    if (typeof solid2d_id !== 'string') return null
    return { type: 'solid2d', solid2d_id }
  }

  if (type === 'solid3d') {
    const solid3d_id = raw.solid3d_id ?? raw.solid3dId
    if (typeof solid3d_id !== 'string') return null
    return { type: 'solid3d', solid3d_id }
  }

  if (type === 'solid2d_edge' || type === 'solid2dEdge') {
    const edge_id = raw.edge_id ?? raw.edgeId
    if (typeof edge_id !== 'string') return null
    return { type: 'solid2d_edge', edge_id }
  }

  if (type === 'edge') {
    const faces = isArray(raw.faces)
      ? raw.faces.filter((v): v is string => typeof v === 'string')
      : []
    const disambiguators = isArray(raw.disambiguators)
      ? raw.disambiguators.filter((v): v is string => typeof v === 'string')
      : undefined
    const index = typeof raw.index === 'number' ? raw.index : undefined
    return { type: 'edge', faces, disambiguators, index }
  }

  if (type === 'vertex') {
    const faces = isArray(raw.faces)
      ? raw.faces.filter((v): v is string => typeof v === 'string')
      : []
    const disambiguators = isArray(raw.disambiguators)
      ? raw.disambiguators.filter((v): v is string => typeof v === 'string')
      : undefined
    const index = typeof raw.index === 'number' ? raw.index : undefined
    return { type: 'vertex', faces, disambiguators, index }
  }

  return null
}

export async function getEventForQueryEntityTypeWithPoint(
  engineEvent: any, // Using any for now since TypeScript types may not be updated yet
  {
    artifactGraph,
    rustContext,
  }: {
    artifactGraph: ArtifactGraph
    rustContext: RustContext
  }
): Promise<ModelingMachineEvent | null> {
  const data = engineEvent?.data as { reference?: any } | undefined
  if (!data?.reference) {
    // No reference - clear selection (clicked in empty space)
    return {
      type: 'Set selection',
      data: { selectionType: 'singleCodeCursor' },
    }
  }

  let entityRef = normalizeEntityReference(data.reference)
  if (!entityRef) {
    return {
      type: 'Set selection',
      data: { selectionType: 'singleCodeCursor' },
    }
  }

  if (
    entityRef.type === 'edge' &&
    entityRef.faces.length === 0 &&
    (!entityRef.disambiguators || entityRef.disambiguators.length === 0)
  ) {
    return {
      type: 'Set selection',
      data: { selectionType: 'singleCodeCursor' },
    }
  }

  // Check if a face EntityReference should be converted to solid2d
  // This happens when clicking on a solid2d profile that hasn't been extruded yet
  if (entityRef.type === 'face' && entityRef.face_id) {
    // First, check if the face_id itself is a solid2d ID
    const directSolid2d = artifactGraph.get(entityRef.face_id)
    if (directSolid2d && directSolid2d.type === 'solid2d') {
      entityRef = {
        type: 'solid2d',
        solid2d_id: entityRef.face_id,
      }
    } else {
      // Try to find solid2d through wall/cap -> segment/sweep -> path
      const faceArtifact = artifactGraph.get(entityRef.face_id)
      if (faceArtifact) {
        let pathId: string | undefined

        // For walls: face -> segment -> path
        if (faceArtifact.type === 'wall') {
          const segment = artifactGraph.get(faceArtifact.segId)
          if (segment && segment.type === 'segment') {
            pathId = segment.pathId
          }
        }
        // For caps: face -> sweep -> path
        else if (faceArtifact.type === 'cap') {
          const sweep = artifactGraph.get(faceArtifact.sweepId)
          if (sweep && sweep.type === 'sweep') {
            pathId = sweep.pathId
          }
        }

        // Check if the path has a solid2d_id
        if (pathId) {
          const path = artifactGraph.get(pathId)
          if (path && path.type === 'path' && path.solid2dId) {
            // Convert face EntityReference to solid2d EntityReference
            entityRef = {
              type: 'solid2d',
              solid2d_id: path.solid2dId,
            }
          }
        } else {
          // If we can't find a path through wall/cap, search all paths for a matching solid2d
          // This handles the case where the solid2d hasn't been extruded yet
          for (const [pathId, pathArtifact] of artifactGraph.entries()) {
            if (pathArtifact.type === 'path' && pathArtifact.solid2dId) {
              // Check if this solid2d's path matches the face somehow
              // For now, we'll check if any segment in this path could be related
              const solid2d = artifactGraph.get(pathArtifact.solid2dId)
              if (solid2d && solid2d.type === 'solid2d') {
                // If the face_id matches the solid2d ID or path ID, convert it
                if (
                  entityRef.face_id === pathArtifact.solid2dId ||
                  entityRef.face_id === pathId
                ) {
                  entityRef = {
                    type: 'solid2d',
                    solid2d_id: pathArtifact.solid2dId,
                  }
                  break
                }
              }
            }
          }
        }
      }
    }
  }

  // Get the entity ID from the EntityReference to find the artifact
  let entityId: string | undefined
  if (entityRef.type === 'plane') {
    entityId = entityRef.plane_id
  } else if (entityRef.type === 'face') {
    entityId = entityRef.face_id
  } else if (entityRef.type === 'solid2d') {
    entityId = entityRef.solid2d_id
  } else if (entityRef.type === 'solid3d') {
    entityId = entityRef.solid3d_id
  } else if (entityRef.type === 'solid2d_edge') {
    // For Solid2D edges, the edge_id is the curve UUID
    // We'll use it to find the segment later in getCodeRefsFromEntityReference
    entityId = entityRef.edge_id
  } else if (entityRef.type === 'edge' && entityRef.faces.length > 0) {
    // For edges, we need to find the edge artifact from the faces
    // Try to find an edge artifact that connects these faces
    // This is a temporary approach - ideally we'd query the engine for the edge ID
    // For now, we'll try to find it from the artifact graph
    const faceArtifacts = entityRef.faces
      .map((faceId) => artifactGraph.get(faceId))
      .filter(Boolean)
    if (faceArtifacts.length > 0) {
      // Try to find a sweepEdge that connects these faces
      // This is a simplified approach
      const firstFace = faceArtifacts[0]
      if (
        firstFace &&
        (firstFace.type === 'wall' || firstFace.type === 'cap')
      ) {
        // Look for edges in the commonSurfaceIds
        // This is not ideal but works for now
        entityId = firstFace.id
      }
    }
  } else if (entityRef.type === 'vertex' && entityRef.faces.length > 0) {
    // Similar approach for vertices
    entityId = entityRef.faces[0]
  }

  // Handle special cases (axes, default planes)
  if (entityId && [X_AXIS_UUID, Y_AXIS_UUID].includes(entityId)) {
    return {
      type: 'Set selection',
      data: {
        selectionType: 'axisSelection',
        selection: X_AXIS_UUID === entityId ? 'x-axis' : 'y-axis',
      },
    }
  }

  const foundDefaultPlane =
    entityId &&
    rustContext.defaultPlanes !== null &&
    Object.entries(rustContext.defaultPlanes).find(
      ([, plane]) => plane === entityId
    )
  if (foundDefaultPlane) {
    return {
      type: 'Set selection',
      data: {
        selectionType: 'defaultPlaneSelection',
        selection: {
          name: foundDefaultPlane[0] as DefaultPlaneStr,
          id: entityId!,
        },
      },
    }
  }

  // For edges, vertices, and solid2d_edge, use getCodeRefsFromEntityReference to handle references
  let codeRefs: any[] | undefined
  if (
    entityRef.type === 'edge' ||
    entityRef.type === 'vertex' ||
    entityRef.type === 'solid2d_edge'
  ) {
    const refs = getCodeRefsFromEntityReference(entityRef, artifactGraph)
    if (refs && refs.length > 0) {
      codeRefs = refs.map((ref) => ({ range: ref.range }))
    }
  } else if (entityId) {
    const _artifact = artifactGraph.get(entityId)
    if (_artifact) {
      const refs = getCodeRefsByArtifactId(entityId, artifactGraph)
      codeRefs = refs || undefined
    }
  }

  // Create V2 selection only - don't create V1 selection
  const selectionV2: SelectionV2 = {
    entityRef,
    codeRef: codeRefs?.[0],
  }

  // Return V2 selection only - don't include V1 selection
  return {
    type: 'Set selection',
    data: {
      selectionType: 'singleCodeCursor',
      selectionV2,
      // Explicitly don't set 'selection' to avoid creating V1 selection
    },
  }
}

export function getEventForSegmentSelection(
  obj: Object3D,
  ast: Node<Program>,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): ModelingMachineEvent | null {
  const group = getParentGroup(obj, SEGMENT_BODIES_PLUS_PROFILE_START)
  const axisGroup = getParentGroup(obj, [AXIS_GROUP])
  if (!group && !axisGroup) return null
  if (axisGroup?.userData.type === AXIS_GROUP) {
    return {
      type: 'Set selection',
      data: {
        selectionType: 'axisSelection',
        selection: obj?.userData?.type === X_AXIS ? 'x-axis' : 'y-axis',
      },
    }
  }
  // id does not match up with the artifact graph when in sketch mode, because mock executions
  // do not update the artifact graph, therefore we match up the pathToNode instead
  // we can reliably use `type === 'segment'` since it's in sketch mode and we're concerned with segments
  const segWithMatchingPathToNode__Id = [...artifactGraph].find((entry) => {
    return (
      entry[1].type === 'segment' &&
      JSON.stringify(entry[1].codeRef.pathToNode) ===
        JSON.stringify(group?.userData?.pathToNode)
    )
  })?.[0]

  const id = segWithMatchingPathToNode__Id

  if (!id && group) {
    const node = getNodeFromPath<Expr>(
      ast,
      group.userData.pathToNode,
      wasmInstance
    )
    if (err(node)) return null
    return {
      type: 'Set selection',
      data: {
        selectionType: 'singleCodeCursor',
        selection: {
          codeRef: {
            range: topLevelRange(node.node.start, node.node.end),
            pathToNode: group.userData.pathToNode,
          },
        },
      },
    }
  }
  if (!id || !group) return null
  const artifact = artifactGraph.get(id)
  if (!artifact) return null
  const node = getNodeFromPath<Expr>(
    ast,
    group.userData.pathToNode,
    wasmInstance
  )
  if (err(node)) return null
  return {
    type: 'Set selection',
    data: {
      selectionType: 'singleCodeCursor',
      selection: {
        artifact,
        codeRef: {
          pathToNode: group?.userData?.pathToNode,
          range: [node.node.start, node.node.end, 0],
        },
      },
    },
  }
}

export function handleSelectionBatch({
  selections,
  artifactGraph,
  code,
  ast,
  systemDeps,
}: {
  selections: Selections
  artifactGraph: ArtifactGraph
  code: string
  ast: Node<Program>
  systemDeps: {
    sceneEntitiesManager: SceneEntities
    engineCommandManager: ConnectionManager
    wasmInstance: ModuleType
  }
}): {
  engineEvents: WebSocketRequest[]
  codeMirrorSelection: EditorSelection
  updateSceneObjectColors: () => void
} {
  const ranges: ReturnType<typeof EditorSelection.cursor>[] = []
  const selectionToEngine: SelectionToEngine[] = []

  let engineEvents: WebSocketRequest[] = []

  const entityReferences: EntityReference[] = selections.graphSelectionsV2
    .map((v2Sel) => v2Sel.entityRef)
    .filter((ref): ref is EntityReference => ref !== undefined)

  if (entityReferences.length > 0) {
    engineEvents = setEngineEntitySelectionV2(entityReferences, systemDeps)
  } else {
    for (const s of selections.graphSelectionsV2) {
      const codeRef = s.codeRef
      if (!codeRef) continue
      const entityId =
        s.entityRef && 'solid3d_id' in s.entityRef
          ? s.entityRef.solid3d_id
          : s.entityRef && 'solid2d_id' in s.entityRef
            ? s.entityRef.solid2d_id
            : s.entityRef && 'face_id' in s.entityRef
              ? s.entityRef.face_id
              : s.entityRef && 'plane_id' in s.entityRef
                ? s.entityRef.plane_id
                : undefined
      if (entityId) {
        const refRange = getCodeRefsByArtifactId(entityId, artifactGraph)?.[0]
          ?.range
        if (refRange)
          selectionToEngine.push({
            id: entityId,
            range: refRange || defaultSourceRange(),
          })
      }
    }
    engineEvents = resetAndSetEngineEntitySelectionCmds(
      selectionToEngine,
      systemDeps
    )
  }

  selections.graphSelectionsV2.forEach(({ codeRef }) => {
    if (codeRef?.range?.[1]) {
      const safeEnd = Math.min(codeRef.range[1], code.length)
      ranges.push(EditorSelection.cursor(safeEnd))
    }
  })

  const totalSelections = selections.graphSelectionsV2.length
  if (ranges.length)
    return {
      engineEvents,
      codeMirrorSelection: EditorSelection.create(
        ranges,
        totalSelections > 0 ? totalSelections - 1 : 0
      ),
      updateSceneObjectColors: () =>
        updateSceneObjectColors(selections.graphSelectionsV2, ast, systemDeps),
    }

  return {
    codeMirrorSelection: EditorSelection.create(
      [EditorSelection.cursor(code.length)],
      0
    ),
    engineEvents,
    updateSceneObjectColors: () =>
      updateSceneObjectColors(selections.graphSelectionsV2, ast, systemDeps),
  }
}

type SelectionToEngine = {
  id?: string
  range: SourceRange
}

export function processCodeMirrorRanges({
  codeMirrorRanges,
  selectionRanges,
  isShiftDown,
  ast,
  artifactGraph,
  artifactIndex,
  systemDeps,
}: {
  codeMirrorRanges: readonly SelectionRange[]
  selectionRanges: Selections
  isShiftDown: boolean
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  artifactIndex: ArtifactIndex
  systemDeps: {
    sceneEntitiesManager: SceneEntities
    engineCommandManager: ConnectionManager
    wasmInstance: ModuleType
  }
}): null | {
  modelingEvent: ModelingMachineEvent
  engineEvents: WebSocketRequest[]
} {
  const isChange =
    codeMirrorRanges.length !== selectionRanges?.graphSelectionsV2?.length ||
    codeMirrorRanges.some(({ from, to }, i) => {
      return (
        from !== selectionRanges.graphSelectionsV2[i]?.codeRef?.range[0] ||
        to !== selectionRanges.graphSelectionsV2[i]?.codeRef?.range[1]
      )
    })

  if (!isChange) return null
  const codeBasedSelections: Array<{ codeRef: CodeRef; artifact?: Artifact }> =
    codeMirrorRanges.map(({ from, to }) => {
      const pathToNode = getNodePathFromSourceRange(
        ast,
        topLevelRange(from, to)
      )
      return {
        codeRef: {
          range: topLevelRange(from, to),
          pathToNode,
        },
      }
    })
  const idBasedSelections: SelectionToEngine[] = codeToIdSelections(
    codeBasedSelections,
    artifactGraph,
    artifactIndex
  )
  const graphSelectionsV2: SelectionV2[] = []
  for (const { id, range } of idBasedSelections) {
    const pathToNode = getNodePathFromSourceRange(ast, range)
    const codeRef = { range, pathToNode }
    if (!id) {
      const invalidPathToNode =
        pathToNode.length === 1 &&
        pathToNode[0][0] === 'body' &&
        pathToNode[0][1] === ''
      if (invalidPathToNode) {
        console.warn('Could not find valid pathToNode, found:', pathToNode)
        continue
      }
      graphSelectionsV2.push({ codeRef })
      continue
    }
    const artifact = artifactGraph.get(id)
    const codeRefs = getCodeRefsByArtifactId(id, artifactGraph)
    const resolvedCodeRef = codeRefs?.[0] ?? codeRef
    if (artifact) {
      graphSelectionsV2.push({
        entityRef: artifactToEntityRef(artifact.type, id),
        codeRef: resolvedCodeRef,
      })
    } else {
      graphSelectionsV2.push({ codeRef: resolvedCodeRef })
    }
  }

  if (!selectionRanges) return null
  updateSceneObjectColors(codeBasedSelections, ast, systemDeps)
  return {
    modelingEvent: {
      type: 'Set selection',
      data: {
        selectionType: 'mirrorCodeMirrorSelections',
        selection: {
          otherSelections: isShiftDown ? selectionRanges.otherSelections : [],
          graphSelectionsV2,
        },
      },
    },
    engineEvents: resetAndSetEngineEntitySelectionCmds(
      idBasedSelections.filter(({ id }) => !!id),
      systemDeps
    ),
  }
}

function updateSceneObjectColors(
  codeBasedSelections: Array<{ codeRef?: { range?: SourceRange } }>,
  ast: Node<Program>,
  {
    sceneEntitiesManager,
    wasmInstance,
  }: {
    sceneEntitiesManager: SceneEntities
    wasmInstance: ModuleType
  }
) {
  const updated = ast

  Object.values(sceneEntitiesManager.activeSegments).forEach((segmentGroup) => {
    if (!SEGMENT_BODIES_PLUS_PROFILE_START.includes(segmentGroup?.name)) return
    const nodeMeta = getNodeFromPath<Node<CallExpressionKw>>(
      updated,
      segmentGroup.userData.pathToNode,
      wasmInstance,
      ['CallExpressionKw']
    )
    if (err(nodeMeta)) return
    const node = nodeMeta.node
    const groupHasCursor = codeBasedSelections.some((selection) => {
      const range = selection?.codeRef?.range
      return (
        range != null && isOverlap(range, topLevelRange(node.start, node.end))
      )
    })

    const color = groupHasCursor
      ? SEGMENT_BLUE
      : segmentGroup?.userData?.baseColor || 0xffffff
    segmentGroup.traverse((child) => {
      child instanceof Mesh && child.material.color.set(color)
    })
    // This is only needed if we want the extra segment to be blue when selected, even if it's still hovered
    updateExtraSegments(segmentGroup, 'selected', groupHasCursor)
    updateExtraSegments(segmentGroup, 'hoveringLine', false)

    // TODO if we had access to the xstate context and therefore selections
    // we wouldn't need to set this here,
    // it would be better to treat xstate context as the source of truth instead of having
    // extra redundant state floating around
    segmentGroup.userData.isSelected = groupHasCursor
  })
}

export function updateExtraSegments(
  parent: Object3D | null,
  className: string,
  value: boolean
) {
  const extraSegmentGroup = parent?.getObjectByName(EXTRA_SEGMENT_HANDLE)
  if (extraSegmentGroup) {
    extraSegmentGroup.traverse((child) => {
      if (child instanceof CSS2DObject) {
        child.element.classList.toggle(className, value)
      }
    })
  }
}

function resetAndSetEngineEntitySelectionCmds(
  selections: SelectionToEngine[],
  systemDeps: {
    engineCommandManager: ConnectionManager
  }
): WebSocketRequest[] {
  if (
    systemDeps.engineCommandManager.connection?.pingIntervalId === undefined
  ) {
    return []
  }
  return [
    {
      type: 'modeling_cmd_req',
      cmd: {
        type: 'select_clear',
      },
      cmd_id: uuidv4(),
    },
    {
      type: 'modeling_cmd_req',
      cmd: {
        type: 'select_add',
        entities: selections.map(({ id }) => id).filter(isNonNullable),
      },
      cmd_id: uuidv4(),
    },
  ]
}

function setEngineEntitySelectionV2(
  entityReferences: EntityReference[],
  systemDeps: {
    engineCommandManager: ConnectionManager
  }
): WebSocketRequest[] {
  if (
    systemDeps.engineCommandManager.connection?.pingIntervalId === undefined
  ) {
    return []
  }
  return [
    {
      type: 'modeling_cmd_req',
      cmd: {
        type: 'select_entity',
        entities: entityReferences,
      } as any, // @kittycad/lib types may not be updated yet, but engine supports it
      cmd_id: uuidv4(),
    },
  ] as WebSocketRequest[]
}

/**
 * Is the selection a single cursor in a sketch pipe expression chain?
 */
export function isSketchPipe(
  selectionRanges: Selections,
  ast: Node<Program>,
  artifactGraph: ArtifactGraph
) {
  if (!isSingleCursorInPipe(selectionRanges, ast)) return false
  return isCursorInSketchCommandRange(artifactGraph, selectionRanges)
}

// This accounts for non-geometry selections under "other"
export type ResolvedSelectionType = Artifact['type'] | 'other'
export type SelectionCountsByType = Map<ResolvedSelectionType, number>

/**
 * In the future, I'd like this function to properly return the type of each selected entity based on
 * its code source range, so that we can show something like "0 objects" or "1 face" or "1 line, 2 edges",
 * and then validate the selection in CommandBarSelectionInput.tsx and show the proper label.
 * @param selection
 * @returns
 */
export function getSelectionCountByType(
  ast: Node<Program>,
  selection?: Selections
): SelectionCountsByType | 'none' {
  const selectionsByType: SelectionCountsByType = new Map()
  if (
    !selection ||
    (!selection.graphSelectionsV2.length && !selection.otherSelections.length)
  )
    return 'none'

  function incrementOrInitializeSelectionType(type: ResolvedSelectionType) {
    const count = selectionsByType.get(type) || 0
    selectionsByType.set(type, count + 1)
  }

  selection.otherSelections.forEach((sel) => {
    if (typeof sel === 'string') {
      incrementOrInitializeSelectionType('other')
    } else if ('name' in sel) {
      incrementOrInitializeSelectionType('plane')
    }
  })

  selection.graphSelectionsV2.forEach((v2Selection) => {
    if (v2Selection.entityRef) {
      if (v2Selection.entityRef.type === 'edge') {
        incrementOrInitializeSelectionType('sweepEdge')
      } else if (v2Selection.entityRef.type === 'solid2d_edge') {
        incrementOrInitializeSelectionType('segment')
      } else if (v2Selection.entityRef.type === 'vertex') {
        incrementOrInitializeSelectionType('other')
      } else if (v2Selection.entityRef.type === 'face') {
        incrementOrInitializeSelectionType('other')
      } else if (v2Selection.entityRef.type === 'plane') {
        incrementOrInitializeSelectionType('plane')
      } else if (v2Selection.entityRef.type === 'solid2d') {
        incrementOrInitializeSelectionType('solid2d')
      } else if (v2Selection.entityRef.type === 'solid3d') {
        incrementOrInitializeSelectionType('path')
      }
    } else if (v2Selection.codeRef && isSingleCursorInPipe(selection, ast)) {
      incrementOrInitializeSelectionType('segment')
    } else {
      incrementOrInitializeSelectionType('other')
    }
  })

  return selectionsByType
}

export function getSelectionTypeDisplayText(
  ast: Node<Program>,
  selection?: Selections
): string | null {
  const selectionsByType = getSelectionCountByType(ast, selection)
  if (selectionsByType === 'none') return null

  return [...selectionsByType.entries()]
    .map(
      // Hack for showing "face" instead of "extrude-wall" in command bar text
      ([type, count]) =>
        `${count} ${type.replace('wall', 'face').replace('solid2d', 'profile')}${
          count > 1 ? 's' : ''
        }`
    )
    .join(', ')
}

export function canSubmitSelectionArg(
  selectionsByType: 'none' | Map<ResolvedSelectionType, number>,
  argument: CommandArgument<unknown> & {
    inputType: 'selection' | 'selectionMixed'
  }
) {
  if (selectionsByType === 'none') {
    return false
  }

  // Filter to only selection types that match the argument's allowed types
  const relevantSelections = [...selectionsByType.entries()].filter(([type]) =>
    argument.selectionTypes.includes(type as Artifact['type'])
  )

  if (relevantSelections.length === 0) {
    return false
  }

  // Check if all relevant selections are valid
  return relevantSelections.every(([type, count]) => {
    return !argument.multiple ? count < 2 && count > 0 : count > 0
  })
}

/**
 * Find the index of the last range where range.start < targetStart. When there
 * are ranges with equal start positions just before the targetStart, the first
 * one is returned. The returned index can be used as a starting point for
 * linear search of overlapping ranges.
 *
 * @param index The sorted array of ranges to search through
 * @param targetStart The start position to compare against
 * @returns The index of the last range where range[0] < targetStart
 */
export function findLastRangeStartingBefore(
  index: ArtifactIndex,
  targetStart: number
): number {
  if (index.length === 0) {
    return 0
  }

  let left = 0
  let right = index.length - 1
  let lastValidIndex = 0

  while (left <= right) {
    const mid = left + Math.floor((right - left) / 2)
    const midRange = index[mid].range

    if (midRange[0] < targetStart) {
      // This range starts before our selection, look in right half for later ones
      lastValidIndex = mid
      left = mid + 1
    } else {
      // This range starts at or after our selection, look in left half
      right = mid - 1
    }
  }

  // We may have passed the correct index. Consider what happens when there are
  // duplicates. We found the last one, but earlier ones need to be checked too.
  let resultIndex = lastValidIndex
  let resultRange = index[resultIndex].range
  for (let i = lastValidIndex - 1; i >= 0; i--) {
    const range = index[i].range
    if (range[0] === resultRange[0]) {
      resultIndex = i
      resultRange = range
    } else {
      break
    }
  }

  return resultIndex
}

function findOverlappingArtifactsFromIndex(
  selection: Selection,
  index: ArtifactIndex
): ArtifactEntry[] {
  if (!selection.codeRef?.range) {
    console.warn('Selection missing code reference range')
    return []
  }

  const selectionRange = selection.codeRef.range
  const results: ArtifactEntry[] = []

  // Binary search to find the last range where range[0] < selectionRange[0]
  // This search does not take into consideration the end range, so it's possible
  // the index it finds dose not have any overlap (depending on the end range)
  // but it's main purpose is to act as a starting point for the linear part of the search
  // so a tiny loss in efficiency is acceptable to keep the code simple
  const startIndex = findLastRangeStartingBefore(index, selectionRange[0])

  // Check all potential overlaps from the found position
  for (let i = startIndex; i < index.length; i++) {
    const { range, entry } = index[i]
    // Stop if we've gone past possible overlaps
    if (range[0] > selectionRange[1]) break

    if (isOverlap(range, selectionRange)) {
      results.push(entry)
    }
  }

  return results
}

function getBestCandidate(
  entries: ArtifactEntry[],
  artifactGraph: ArtifactGraph
): ArtifactEntry | undefined {
  if (!entries.length) {
    return undefined
  }
  const sketchBlock = entries.find(
    (entry) => entry.artifact.type === 'sketchBlock'
  )
  if (sketchBlock) {
    return sketchBlock
  }

  for (const entry of entries) {
    // Segments take precedence
    if (entry.artifact.type === 'segment') {
      return entry
    }

    // Handle paths and their solid2d references
    if (entry.artifact.type === 'path') {
      const solid2dId = entry.artifact.solid2dId
      if (!solid2dId) {
        return entry
      }
      const solid2d = artifactGraph.get(solid2dId)
      if (solid2d?.type === 'solid2d') {
        return { id: solid2dId, artifact: solid2d }
      }
      continue
    }

    // Other valid artifact types
    if (
      ['plane', 'cap', 'wall', 'sweep', 'sketchBlock'].includes(
        entry.artifact.type
      )
    ) {
      return entry
    }
  }
  return undefined
}

function createSelectionToEngine(
  selection: Selection,
  candidateId?: ArtifactId
): SelectionToEngine {
  return {
    ...(candidateId && { id: candidateId }),
    range: selection.codeRef.range,
  }
}

export function codeToIdSelections(
  selections: Selection[],
  artifactGraph: ArtifactGraph,
  artifactIndex: ArtifactIndex
): SelectionToEngine[] {
  if (!selections?.length) {
    return []
  }

  if (!artifactGraph) {
    console.warn('Artifact graph is missing or empty')
    return selections.map((selection) => createSelectionToEngine(selection))
  }

  return selections
    .flatMap((selection): SelectionToEngine[] => {
      if (!selection) {
        console.warn('Null or undefined selection encountered')
        return []
      }

      // Direct artifact case
      if (selection.artifact?.id) {
        return [createSelectionToEngine(selection, selection.artifact.id)]
      }

      // Find matching artifacts by code range overlap
      const overlappingEntries = findOverlappingArtifactsFromIndex(
        selection,
        artifactIndex
      )
      const bestCandidate = getBestCandidate(overlappingEntries, artifactGraph)

      return [createSelectionToEngine(selection, bestCandidate?.id)]
    })
    .filter(isNonNullable)
}

export async function sendQueryEntityTypeWithPoint(
  e: React.MouseEvent<HTMLDivElement, MouseEvent>,
  videoRef: HTMLVideoElement,
  systemDeps: {
    engineCommandManager: ConnectionManager
  }
) {
  const { x, y } = getNormalisedCoordinates(
    e,
    videoRef,
    systemDeps.engineCommandManager.streamDimensions
  )
  let res = await systemDeps.engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd: {
      type: 'query_entity_type_with_point' as any, // Type may not be in generated types yet
      selected_at_window: { x, y },
      selection_type: 'add',
    },
    cmd_id: uuidv4(),
  })
  if (!res) {
    console.warn('No response')
    return undefined
  }

  if (isArray(res)) {
    res = res[0]
  }
  const singleRes = res
  if (isModelingResponse(singleRes)) {
    const mr = singleRes.resp.data.modeling_response as any
    if (mr.type === 'query_entity_type_with_point') return mr.data
  }
  return undefined
}

export function updateSelections(
  pathToNodeMap: PathToNodeMap,
  prevSelectionRanges: Selections,
  ast: Program | Error,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): Selections | Error {
  if (err(ast)) return ast

  const newSelections = Object.entries(pathToNodeMap)
    .map(([index, pathToNode]): SelectionV2 | undefined => {
      const previousV2 = prevSelectionRanges.graphSelectionsV2[Number(index)]
      const previousResolved =
        previousV2 != null
          ? resolveSelectionV2(previousV2, artifactGraph)
          : null
      const nodeMeta = getNodeFromPath<Expr>(ast, pathToNode, wasmInstance)
      if (err(nodeMeta)) return undefined
      const node = nodeMeta.node
      let artifact: Artifact | null = null
      let artifactId: string | undefined
      for (const [id, a] of artifactGraph) {
        if (previousResolved?.artifact?.type === a.type) {
          const codeRefs = getCodeRefsByArtifactId(id, artifactGraph)
          if (!codeRefs) continue
          if (
            JSON.stringify(codeRefs[0].pathToNode) ===
            JSON.stringify(pathToNode)
          ) {
            artifact = a
            artifactId = id
            break
          }
        }
      }
      if (!artifact || artifactId == null) return undefined
      const codeRef = {
        range: topLevelRange(node.start, node.end),
        pathToNode: pathToNode,
      }
      const entityRef = artifactToEntityRef(artifact.type, artifactId)
      return { entityRef, codeRef }
    })
    .filter((x?: SelectionV2) => x !== undefined)

  const pathToNodeBasedSelections: SelectionV2[] = []
  for (const pathToNode of Object.values(pathToNodeMap)) {
    const node = getNodeFromPath<Expr>(ast, pathToNode, wasmInstance)
    if (err(node)) return node
    pathToNodeBasedSelections.push({
      codeRef: {
        range: topLevelRange(node.node.start, node.node.end),
        pathToNode: pathToNode,
      },
    })
  }

  return {
    graphSelectionsV2:
      newSelections.length >= pathToNodeBasedSelections.length
        ? newSelections
        : pathToNodeBasedSelections,
    otherSelections: prevSelectionRanges.otherSelections,
  }
}

const semanticEntityNames: {
  [key: string]: Array<Artifact['type'] | 'defaultPlane'>
} = {
  face: ['wall', 'cap'],
  profile: ['solid2d'],
  edge: ['segment', 'sweepEdge', 'edgeCutEdge'],
  point: [],
  plane: ['defaultPlane'],
}

/** Convert selections to a human-readable format */
export function getSemanticSelectionType(selectionType: Artifact['type'][]) {
  const semanticSelectionType = new Set()
  for (const type of selectionType) {
    for (const [entity, entityTypes] of Object.entries(semanticEntityNames)) {
      if (entityTypes.includes(type)) {
        semanticSelectionType.add(entity)
      }
    }
  }

  return Array.from(semanticSelectionType)
}

export function getDefaultSketchPlaneData(
  defaultPlaneId: string,
  systemDeps: {
    rustContext: RustContext
    sceneInfra: SceneInfra
  }
): Error | false | DefaultPlane {
  const { sceneInfra, rustContext } = systemDeps
  const defaultPlanes = rustContext.defaultPlanes
  if (!defaultPlanes) {
    return new Error('No default planes defined in rustContext')
  }

  if (
    ![
      defaultPlanes.xy,
      defaultPlanes.xz,
      defaultPlanes.yz,
      defaultPlanes.negXy,
      defaultPlanes.negXz,
      defaultPlanes.negYz,
    ].includes(defaultPlaneId)
  ) {
    // Supplied defaultPlaneId is not a valid default plane id
    return false
  }

  const camVector = sceneInfra.camControls.camera.position
    .clone()
    .sub(sceneInfra.camControls.target)

  // TODO can we get this information from rust land when it creates the default planes?
  // maybe returned from make_default_planes (src/wasm-lib/src/wasm.rs)
  let zAxis: [number, number, number] = [0, 0, 1]
  let yAxis: [number, number, number] = [0, 1, 0]

  if (defaultPlanes?.xy === defaultPlaneId) {
    zAxis = [0, 0, 1]
    yAxis = [0, 1, 0]
    if (camVector.z < 0) {
      zAxis = [0, 0, -1]
      defaultPlaneId = defaultPlanes?.negXy || ''
    }
  } else if (defaultPlanes?.yz === defaultPlaneId) {
    zAxis = [1, 0, 0]
    yAxis = [0, 0, 1]
    if (camVector.x < 0) {
      zAxis = [-1, 0, 0]
      defaultPlaneId = defaultPlanes?.negYz || ''
    }
  } else if (defaultPlanes?.xz === defaultPlaneId) {
    zAxis = [0, 1, 0]
    yAxis = [0, 0, 1]
    defaultPlaneId = defaultPlanes?.negXz || ''
    if (camVector.y < 0) {
      zAxis = [0, -1, 0]
      defaultPlaneId = defaultPlanes?.xz || ''
    }
  }

  const defaultPlaneStrMap: Record<string, DefaultPlaneStr> = {
    [defaultPlanes.xy]: 'XY',
    [defaultPlanes.xz]: 'XZ',
    [defaultPlanes.yz]: 'YZ',
    [defaultPlanes.negXy]: '-XY',
    [defaultPlanes.negXz]: '-XZ',
    [defaultPlanes.negYz]: '-YZ',
  }

  return {
    type: 'defaultPlane',
    planeId: defaultPlaneId,
    plane: defaultPlaneStrMap[defaultPlaneId],
    zAxis,
    yAxis,
  }
}
export async function getPlaneDataFromSketchBlock(
  sketchBlock: Extract<Artifact, { type: 'sketchBlock' }>,
  artifactGraph: ArtifactGraph,
  systemDeps: {
    rustContext: RustContext
    sceneInfra: SceneInfra
  }
): Promise<DefaultPlane | OffsetPlane | ExtrudeFacePlane | null> {
  // TODO this function is stubbed out for now since sketchBlocks really only work on default planes
  // and I don't think we have enough info or the sketchBlock.planeId is wrong, so it just default to the
  // XY no matter what for now

  // Similar logic to selectSketchPlane but for a sketchBlock artifact
  if (!sketchBlock.planeId) {
    return null
  }

  // Try to get the artifact from the graph
  const _artifact = artifactGraph.get(sketchBlock.planeId)

  // Use the default XY plane.
  // This is a temporary solution while we determine the proper approach for default planes
  if (true) {
    const defaultPlanes = systemDeps.rustContext.defaultPlanes
    if (defaultPlanes?.xy) {
      const defaultResult = getDefaultSketchPlaneData(
        defaultPlanes.xy,
        systemDeps
      )
      if (!err(defaultResult) && defaultResult) {
        return defaultResult
      }
    }
    return null
  }

  return null
}

export function selectDefaultSketchPlane(
  defaultPlaneId: string,
  systemDeps: {
    sceneInfra: SceneInfra
    rustContext: RustContext
  }
): Error | boolean {
  const { sceneInfra } = systemDeps
  const result = getDefaultSketchPlaneData(defaultPlaneId, systemDeps)
  if (err(result) || result === false) return result
  sceneInfra.modelingSend({
    type: 'Select sketch plane',
    data: result,
  })
  return true
}

export async function getOffsetSketchPlaneData(
  artifact: Artifact | undefined,
  systemDeps: {
    sceneInfra: SceneInfra
    sceneEntitiesManager: SceneEntities
  }
): Promise<Error | false | OffsetPlane> {
  const { sceneInfra } = systemDeps
  if (artifact?.type !== 'plane') {
    return new Error(
      `Invalid artifact type for offset sketch plane selection: ${artifact?.type}`
    )
  }
  const planeId = artifact.id
  try {
    const planeInfo =
      await systemDeps.sceneEntitiesManager.getFaceDetails(planeId)

    // Apply camera-based orientation logic similar to default planes
    let zAxis: [number, number, number] = [
      planeInfo.z_axis.x,
      planeInfo.z_axis.y,
      planeInfo.z_axis.z,
    ]
    let yAxis: [number, number, number] = [
      planeInfo.y_axis.x,
      planeInfo.y_axis.y,
      planeInfo.y_axis.z,
    ]

    // Get camera vector to determine which side of the plane we're viewing from
    const camVector = sceneInfra.camControls.camera.position
      .clone()
      .sub(sceneInfra.camControls.target)

    // Determine the canonical (absolute) plane orientation
    const absZAxis: [number, number, number] = [
      Math.abs(zAxis[0]),
      Math.abs(zAxis[1]),
      Math.abs(zAxis[2]),
    ]

    // Find the dominant axis (like default planes do)
    const maxComponent = Math.max(...absZAxis)
    const dominantAxisIndex = absZAxis.indexOf(maxComponent)

    // Check camera position against canonical orientation (like default planes)
    const cameraComponents = [camVector.x, camVector.y, camVector.z]
    let negated = cameraComponents[dominantAxisIndex] < 0
    if (dominantAxisIndex === 1) {
      // offset of the XZ is being weird, not sure if this is a camera bug
      negated = !negated
    }
    return {
      type: 'offsetPlane',
      zAxis,
      yAxis,
      position: [
        planeInfo.origin.x,
        planeInfo.origin.y,
        planeInfo.origin.z,
      ].map((num) => num / sceneInfra.baseUnitMultiplier) as [
        number,
        number,
        number,
      ],
      planeId,
      pathToNode: artifact.codeRef.pathToNode,
      negated,
    }
  } catch (err) {
    console.error(err)
    return new Error('Error getting face details')
  }
}

export async function selectOffsetSketchPlane(
  artifact: Artifact | undefined,
  systemDeps: {
    sceneInfra: SceneInfra
    sceneEntitiesManager: SceneEntities
  }
): Promise<Error | boolean> {
  const { sceneInfra } = systemDeps
  const result = await getOffsetSketchPlaneData(artifact, systemDeps)
  if (err(result) || result === false) return result

  try {
    sceneInfra.modelingSend({
      type: 'Select sketch plane',
      data: result,
    })
  } catch (err) {
    console.error(err)
    return false
  }
  return true
}

export async function selectionBodyFace(
  planeOrFaceId: ArtifactId,
  artifactGraph: ArtifactGraph,
  ast: Node<Program>,
  execState: ExecState,
  systemDeps: {
    sceneInfra: SceneInfra
    rustContext: RustContext
    sceneEntitiesManager: SceneEntities
    wasmInstance: ModuleType
  }
): Promise<ExtrudeFacePlane | undefined> {
  const { sceneInfra } = systemDeps
  const defaultSketchPlaneSelected = selectDefaultSketchPlane(
    planeOrFaceId,
    systemDeps
  )
  if (!err(defaultSketchPlaneSelected) && defaultSketchPlaneSelected) {
    return
  }

  const artifact = artifactGraph.get(planeOrFaceId)
  const offsetPlaneSelected = await selectOffsetSketchPlane(
    artifact,
    systemDeps
  )
  if (!err(offsetPlaneSelected) && offsetPlaneSelected) {
    return
  }

  // Artifact is likely an sweep face
  const faceId = planeOrFaceId
  const extrusion = getSweepFromSuspectedSweepSurface(faceId, artifactGraph)
  if (!err(extrusion)) {
    const maybeImportNode = getNodeFromPath<ImportStatement>(
      ast,
      extrusion.codeRef.pathToNode,
      systemDeps.wasmInstance,
      ['ImportStatement']
    )
    if (
      !err(maybeImportNode) &&
      maybeImportNode.node &&
      maybeImportNode.node.type === 'ImportStatement'
    ) {
      if (maybeImportNode.node.path.type === 'Kcl') {
        showSketchOnImportToast(maybeImportNode.node.path.filename)
      } else if (maybeImportNode.node.path.type === 'Foreign') {
        showSketchOnImportToast(maybeImportNode.node.path.path)
      } else if (maybeImportNode.node.path.type === 'Std') {
        toast.error("can't sketch on this face")
      } else {
        // force tsc error if more cases are added
        const _exhaustiveCheck: never = maybeImportNode.node.path
      }
    }
  }

  if (
    artifact?.type !== 'cap' &&
    artifact?.type !== 'wall' &&
    !(artifact?.type === 'edgeCut' && artifact.subType === 'chamfer')
  )
    return

  const codeRef =
    artifact.type === 'cap'
      ? getCapCodeRef(artifact, artifactGraph)
      : artifact.type === 'wall'
        ? getWallCodeRef(artifact, artifactGraph)
        : artifact.codeRef

  const faceInfo = await systemDeps.sceneEntitiesManager.getFaceDetails(faceId)
  if (!faceInfo?.origin || !faceInfo?.z_axis || !faceInfo?.y_axis) return
  const { z_axis, y_axis, origin } = faceInfo
  const sketchPathToNode = err(codeRef) ? [] : codeRef.pathToNode

  const edgeCutMeta = getEdgeCutMeta(
    artifact,
    ast,
    artifactGraph,
    systemDeps.wasmInstance
  )
  const _faceInfo: ExtrudeFacePlane['faceInfo'] = edgeCutMeta
    ? edgeCutMeta
    : artifact.type === 'cap'
      ? {
          type: 'cap',
          subType: artifact.subType,
        }
      : { type: 'wall' }

  if (err(extrusion)) {
    return Promise.reject(
      new Error(`Extrusion is not a valid artifact: ${extrusion}`)
    )
  }

  const children = findAllChildrenAndOrderByPlaceInCode(
    { type: 'sweep', ...extrusion },
    artifactGraph
  )
  const lastChildVariable = getLastVariable(
    children,
    ast,
    systemDeps.wasmInstance,
    ['sweep', 'compositeSolid']
  )
  const extrudePathToNode =
    lastChildVariable && !err(lastChildVariable)
      ? lastChildVariable.pathToNode
      : []

  return {
    type: 'extrudeFace',
    zAxis: [z_axis.x, z_axis.y, z_axis.z],
    yAxis: [y_axis.x, y_axis.y, y_axis.z],
    position: [origin.x, origin.y, origin.z].map(
      (num) => num / sceneInfra.baseUnitMultiplier
    ) as [number, number, number],
    sketchPathToNode,
    extrudePathToNode,
    faceInfo: _faceInfo,
    faceId: faceId,
  }
}

export function selectAllInCurrentSketch(
  artifactGraph: ArtifactGraph,
  systemDeps: {
    sceneEntitiesManager: SceneEntities
  }
): Selections {
  const graphSelectionsV2: SelectionV2[] = []

  Object.keys(systemDeps.sceneEntitiesManager.activeSegments).forEach(
    (pathToNodeStr) => {
      for (const [artifactId, artifact] of artifactGraph) {
        if (!['path', 'segment'].includes(artifact.type)) continue
        const codeRefs = getCodeRefsByArtifactId(artifactId, artifactGraph)
        if (!codeRefs?.length) continue
        if (JSON.stringify(codeRefs[0].pathToNode) !== pathToNodeStr) continue
        graphSelectionsV2.push({
          entityRef: artifactToEntityRef(artifact.type, artifactId),
          codeRef: codeRefs[0],
        })
        break
      }
    }
  )

  return {
    graphSelectionsV2,
    otherSelections: [],
  }
}

/**
 * Get code references from an EntityReference by traversing the artifact graph.
 * For edges: finds the two faces, then finds their corresponding wall/cap artifacts,
 * then finds the segments those walls correspond to.
 * For faces: finds the wall/cap artifact and its corresponding segment.
 * For vertices: similar traversal through faces.
 */
export function getCodeRefsFromEntityReference(
  entityRef: EntityReference,
  artifactGraph: ArtifactGraph
): Array<{ range: SourceRange }> | null {
  const codeRefs: Array<{ range: SourceRange }> = []

  if (entityRef.type === 'solid2d' && entityRef.solid2d_id) {
    // For solid2d, get the codeRef directly from the artifact
    const solid2dArtifact = artifactGraph.get(entityRef.solid2d_id)
    if (!solid2dArtifact || solid2dArtifact.type !== 'solid2d') {
      return null
    }
    const codeRefsForSolid2d = getCodeRefsByArtifactId(
      entityRef.solid2d_id,
      artifactGraph
    )
    if (codeRefsForSolid2d && codeRefsForSolid2d.length > 0) {
      codeRefs.push({ range: codeRefsForSolid2d[0].range })
    }
  } else if (entityRef.type === 'solid3d' && entityRef.solid3d_id) {
    // For solid3d, get the codeRef directly from the artifact
    const solid3dArtifact = artifactGraph.get(entityRef.solid3d_id)
    if (
      !solid3dArtifact ||
      (solid3dArtifact.type !== 'sweep' &&
        solid3dArtifact.type !== 'compositeSolid')
    ) {
      return null
    }
    const codeRefsForSolid3d = getCodeRefsByArtifactId(
      entityRef.solid3d_id,
      artifactGraph
    )
    if (codeRefsForSolid3d && codeRefsForSolid3d.length > 0) {
      codeRefs.push({ range: codeRefsForSolid3d[0].range })
    }
  } else if (entityRef.type === 'face' && entityRef.face_id) {
    // For faces, find the wall/cap artifact and traverse to segment
    const faceArtifact = artifactGraph.get(entityRef.face_id)
    if (!faceArtifact) {
      return null
    }

    // Wall artifacts have segId pointing to the segment
    if (faceArtifact.type === 'wall' && faceArtifact.segId) {
      const segArtifact = getArtifactOfTypes(
        { key: faceArtifact.segId, types: ['segment'] },
        artifactGraph
      )
      if (!err(segArtifact) && segArtifact.codeRef) {
        codeRefs.push({ range: segArtifact.codeRef.range })
      }
      // Also get the extrude (sweep) codeRef, like getCodeRefsByArtifactId does
      const extrusion = getSweepFromSuspectedSweepSurface(
        entityRef.face_id,
        artifactGraph
      )
      if (!err(extrusion) && extrusion.codeRef) {
        codeRefs.push({ range: extrusion.codeRef.range })
      }
    }
    // Cap artifacts - get both the cap codeRef and the extrude
    else if (faceArtifact.type === 'cap') {
      const capCodeRef = getCapCodeRef(faceArtifact, artifactGraph)
      if (!err(capCodeRef)) {
        codeRefs.push({ range: capCodeRef.range })
      }
      // Also get the extrude (sweep) codeRef
      const extrusion = getSweepFromSuspectedSweepSurface(
        entityRef.face_id,
        artifactGraph
      )
      if (!err(extrusion) && extrusion.codeRef) {
        codeRefs.push({ range: extrusion.codeRef.range })
      }
    }
  } else if (entityRef.type === 'solid2d_edge' && entityRef.edge_id) {
    // For Solid2D edges, the edge_id is the curve UUID
    // We need to find which segment this curve belongs to
    // Search through all paths with solid2dId to find the matching segment
    for (const [_pathId, pathArtifact] of artifactGraph.entries()) {
      if (pathArtifact.type === 'path' && pathArtifact.solid2dId) {
        // Check all segments in this path
        if (pathArtifact.segIds) {
          for (const segId of pathArtifact.segIds) {
            const segArtifact = artifactGraph.get(segId)
            if (
              segArtifact &&
              segArtifact.type === 'segment' &&
              segArtifact.codeRef
            ) {
              // For now, we'll highlight the segment if the edgeId matches
              // In the future, we could match the curve UUID more precisely
              // But for Solid2D edges, highlighting the whole profile is acceptable
              codeRefs.push({ range: segArtifact.codeRef.range })
            }
          }
        }
        // Also check if the edgeId matches the path or solid2d ID
        const solid2d = artifactGraph.get(pathArtifact.solid2dId)
        if (solid2d && solid2d.type === 'solid2d') {
          const solid2dCodeRef = getSolid2dCodeRef(solid2d, artifactGraph)
          if (!err(solid2dCodeRef)) {
            codeRefs.push({ range: solid2dCodeRef.range })
          }
        }
        break // Found the path, no need to continue
      }
    }
    // If we found codeRefs, return them; otherwise try to find segment by edgeId directly
    if (codeRefs.length === 0) {
      // Try to find segment artifact directly by edgeId
      const segmentArtifact = artifactGraph.get(entityRef.edge_id)
      if (
        segmentArtifact &&
        segmentArtifact.type === 'segment' &&
        segmentArtifact.codeRef
      ) {
        codeRefs.push({ range: segmentArtifact.codeRef.range })
      }
    }
  } else if (
    entityRef.type === 'edge' &&
    entityRef.faces &&
    entityRef.faces.length >= 1
  ) {
    // For edges, find segments from faces and disambiguators
    // Handle both Solid3D (2+ faces) and Solid2D (1 face) cases
    const faceIds = [...entityRef.faces]
    // Also include disambiguator faces
    if (entityRef.disambiguators && entityRef.disambiguators.length > 0) {
      faceIds.push(...entityRef.disambiguators)
    }
    const seenSegments = new Set<string>()

    for (const faceId of faceIds) {
      const faceArtifact = artifactGraph.get(faceId)
      if (!faceArtifact) {
        continue
      }

      // For Solid2D: face is directly a solid2d artifact
      if (faceArtifact.type === 'solid2d') {
        // Get codeRef from the solid2d artifact
        const solid2dCodeRefs = getCodeRefsByArtifactId(faceId, artifactGraph)
        if (solid2dCodeRefs && solid2dCodeRefs.length > 0) {
          codeRefs.push({ range: solid2dCodeRefs[0].range })
        }
        // If we have an index, we could potentially highlight the specific curve/segment
        // but for now, highlighting the whole profile is acceptable
      }
      // Wall artifacts have segId pointing to the segment
      else if (faceArtifact.type === 'wall' && faceArtifact.segId) {
        if (!seenSegments.has(faceArtifact.segId)) {
          seenSegments.add(faceArtifact.segId)
          const segArtifact = getArtifactOfTypes(
            { key: faceArtifact.segId, types: ['segment'] },
            artifactGraph
          )
          if (!err(segArtifact) && segArtifact.codeRef) {
            codeRefs.push({ range: segArtifact.codeRef.range })
          }
        }
        // For edges, don't include the extrude - only highlight the segments
        // (The extrude highlighting is only for face hover, not edge hover)
      }
      // Cap artifacts - for edges, only highlight the cap, not the extrude
      else if (faceArtifact.type === 'cap') {
        const capCodeRef = getCapCodeRef(faceArtifact, artifactGraph)
        if (!err(capCodeRef)) {
          codeRefs.push({ range: capCodeRef.range })
        }
        // For edges, don't include the extrude - only highlight the cap
        // (The extrude highlighting is only for face hover, not edge hover)
      }
    }
  } else if (
    entityRef.type === 'vertex' &&
    entityRef.faces &&
    entityRef.faces.length >= 3
  ) {
    // For vertices, find segments from all faces (typically 3+) and disambiguators
    const faceIds = [...entityRef.faces]
    // Also include disambiguator faces
    if (entityRef.disambiguators && entityRef.disambiguators.length > 0) {
      faceIds.push(...entityRef.disambiguators)
    }
    const seenSegments = new Set<string>()

    for (const faceId of faceIds) {
      const faceArtifact = artifactGraph.get(faceId)
      if (!faceArtifact) {
        continue
      }

      if (faceArtifact.type === 'wall' && faceArtifact.segId) {
        if (!seenSegments.has(faceArtifact.segId)) {
          seenSegments.add(faceArtifact.segId)
          const segArtifact = getArtifactOfTypes(
            { key: faceArtifact.segId, types: ['segment'] },
            artifactGraph
          )
          if (!err(segArtifact) && segArtifact.codeRef) {
            codeRefs.push({ range: segArtifact.codeRef.range })
          }
        }
        // For vertices (like edges), don't include the extrude - only highlight the segments
        // (The extrude highlighting is only for face hover, not vertex hover)
      } else if (faceArtifact.type === 'cap') {
        const capCodeRef = getCapCodeRef(faceArtifact, artifactGraph)
        if (!err(capCodeRef)) {
          codeRefs.push({ range: capCodeRef.range })
        }
        // For vertices (like edges), don't include the extrude - only highlight the cap
        // (The extrude highlighting is only for face hover, not vertex hover)
      }
    }
  }

  return codeRefs.length > 0 ? codeRefs : null
}
