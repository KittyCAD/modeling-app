import type { SelectionRange } from '@codemirror/state'
import { EditorSelection } from '@codemirror/state'
import type { OkModelingCmdResponse, WebSocketRequest } from '@kittycad/lib'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import type { Object3D, Object3DEventMap } from 'three'
import { Mesh } from 'three'

import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  EXTRA_SEGMENT_HANDLE,
  SEGMENT_BLUE,
  SEGMENT_BODIES_PLUS_PROFILE_START,
  getParentGroup,
} from '@src/clientSideScene/sceneConstants'
import { AXIS_GROUP, X_AXIS } from '@src/clientSideScene/sceneUtils'
import { showUnsupportedSelectionToast } from '@src/components/ToastUnsupportedSelection'
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

import {
  getCapCodeRef,
  getCodeRefsByArtifactId,
  getSweepFromSuspectedSweepSurface,
  getWallCodeRef,
} from '@src/lang/std/artifactGraph'
import type { PathToNodeMap } from '@src/lang/util'
import {
  isCursorInSketchCommandRange,
  isTopLevelModule,
  topLevelRange,
} from '@src/lang/util'
import type {
  ArtifactGraph,
  CallExpressionKw,
  Expr,
  Program,
  SourceRange,
} from '@src/lang/wasm'
import type { ArtifactEntry, ArtifactIndex } from '@src/lib/artifactIndex'
import type { CommandArgument } from '@src/lib/commandTypes'
import type { DefaultPlaneStr } from '@src/lib/planes'
import {
  editorManager,
  engineCommandManager,
  kclManager,
  rustContext,
  sceneEntitiesManager,
  sceneInfra,
} from '@src/lib/singletons'
import { err } from '@src/lib/trap'
import {
  getModuleId,
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
import { getStringAfterLastSeparator } from '@src/lib/paths'
import { showSketchOnImportToast } from '@src/components/SketchOnImportToast'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'

export const X_AXIS_UUID = 'ad792545-7fd3-482a-a602-a93924e3055b'
export const Y_AXIS_UUID = '680fd157-266f-4b8a-984f-cdf46b8bdf01'

export async function getEventForSelectWithPoint({
  data,
}: Extract<
  OkModelingCmdResponse,
  { type: 'select_with_point' }
>): Promise<ModelingMachineEvent | null> {
  if (!data?.entity_id) {
    return {
      type: 'Set selection',
      data: { selectionType: 'singleCodeCursor' },
    }
  }
  if ([X_AXIS_UUID, Y_AXIS_UUID].includes(data.entity_id)) {
    return {
      type: 'Set selection',
      data: {
        selectionType: 'axisSelection',
        selection: X_AXIS_UUID === data.entity_id ? 'x-axis' : 'y-axis',
      },
    }
  }

  // Check for default plane selection
  const foundDefaultPlane =
    rustContext.defaultPlanes !== null &&
    Object.entries(rustContext.defaultPlanes).find(
      ([, plane]) => plane === data.entity_id
    )
  if (foundDefaultPlane) {
    return {
      type: 'Set selection',
      data: {
        selectionType: 'defaultPlaneSelection',
        selection: {
          name: foundDefaultPlane[0] as DefaultPlaneStr,
          id: data.entity_id,
        },
      },
    }
  }

  let _artifact = kclManager.artifactGraph.get(data.entity_id)
  if (!_artifact) {
    // if there's no artifact but there is a data.entity_id, it means we don't recognize the engine entity
    // we should still return an empty singleCodeCursor to plug into the selection logic
    // (i.e. if the user is holding shift they can keep selecting)
    // but we should also put up a toast
    // toast.error('some edges or faces are not currently selectable')
    showUnsupportedSelectionToast()
    return {
      type: 'Set selection',
      data: { selectionType: 'singleCodeCursor' },
    }
  }
  const codeRefs = getCodeRefsByArtifactId(
    data.entity_id,
    kclManager.artifactGraph
  )
  if (_artifact && codeRefs) {
    return {
      type: 'Set selection',
      data: {
        selectionType: 'singleCodeCursor',
        selection: {
          artifact: _artifact,
          codeRef: codeRefs[0],
        },
      },
    }
  }
  return null
}

export function getEventForSegmentSelection(
  obj: Object3D<Object3DEventMap>
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
  const segWithMatchingPathToNode__Id = [...kclManager.artifactGraph].find(
    (entry) => {
      return (
        entry[1].type === 'segment' &&
        JSON.stringify(entry[1].codeRef.pathToNode) ===
          JSON.stringify(group?.userData?.pathToNode)
      )
    }
  )?.[0]

  const id = segWithMatchingPathToNode__Id

  if (!id && group) {
    const node = getNodeFromPath<Expr>(
      kclManager.ast,
      group.userData.pathToNode
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
  const artifact = kclManager.artifactGraph.get(id)
  if (!artifact) return null
  const node = getNodeFromPath<Expr>(kclManager.ast, group.userData.pathToNode)
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
}: {
  selections: Selections
}): {
  engineEvents: WebSocketRequest[]
  codeMirrorSelection: EditorSelection
  updateSceneObjectColors: () => void
} {
  const ranges: ReturnType<typeof EditorSelection.cursor>[] = []
  const selectionToEngine: SelectionToEngine[] = []

  selections.graphSelections.forEach(({ artifact }) => {
    artifact?.id &&
      selectionToEngine.push({
        id: artifact?.id,
        range:
          getCodeRefsByArtifactId(artifact.id, kclManager.artifactGraph)?.[0]
            .range || defaultSourceRange(),
      })
  })
  const engineEvents: WebSocketRequest[] =
    resetAndSetEngineEntitySelectionCmds(selectionToEngine)
  selections.graphSelections.forEach(({ codeRef }) => {
    if (codeRef.range?.[1]) {
      const safeEnd = Math.min(codeRef.range[1], editorManager.code.length)
      ranges.push(EditorSelection.cursor(safeEnd))
    }
  })
  if (ranges.length)
    return {
      engineEvents,
      codeMirrorSelection: EditorSelection.create(
        ranges,
        selections.graphSelections.length - 1
      ),
      updateSceneObjectColors: () =>
        updateSceneObjectColors(selections.graphSelections),
    }

  return {
    codeMirrorSelection: EditorSelection.create(
      [EditorSelection.cursor(editorManager.code.length)],
      0
    ),
    engineEvents,
    updateSceneObjectColors: () =>
      updateSceneObjectColors(selections.graphSelections),
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
}: {
  codeMirrorRanges: readonly SelectionRange[]
  selectionRanges: Selections
  isShiftDown: boolean
  ast: Program
  artifactGraph: ArtifactGraph
}): null | {
  modelingEvent: ModelingMachineEvent
  engineEvents: WebSocketRequest[]
} {
  const isChange =
    codeMirrorRanges.length !== selectionRanges?.graphSelections?.length ||
    codeMirrorRanges.some(({ from, to }, i) => {
      return (
        from !== selectionRanges.graphSelections[i]?.codeRef?.range[0] ||
        to !== selectionRanges.graphSelections[i]?.codeRef?.range[1]
      )
    })

  if (!isChange) return null
  const codeBasedSelections: Selections['graphSelections'] =
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
    kclManager.artifactIndex
  )
  const selections: Selection[] = []
  for (const { id, range } of idBasedSelections) {
    if (!id) {
      const pathToNode = getNodePathFromSourceRange(ast, range)
      selections.push({
        codeRef: {
          range,
          pathToNode,
        },
      })
      continue
    }
    const artifact = artifactGraph.get(id)
    const codeRefs = getCodeRefsByArtifactId(id, artifactGraph)
    if (artifact && codeRefs) {
      selections.push({ artifact, codeRef: codeRefs[0] })
    } else if (codeRefs) {
      selections.push({ codeRef: codeRefs[0] })
    }
  }

  if (!selectionRanges) return null
  updateSceneObjectColors(codeBasedSelections)
  return {
    modelingEvent: {
      type: 'Set selection',
      data: {
        selectionType: 'mirrorCodeMirrorSelections',
        selection: {
          otherSelections: isShiftDown ? selectionRanges.otherSelections : [],
          graphSelections: selections,
        },
      },
    },
    engineEvents: resetAndSetEngineEntitySelectionCmds(
      idBasedSelections.filter(({ id }) => !!id)
    ),
  }
}

function updateSceneObjectColors(codeBasedSelections: Selection[]) {
  const updated = kclManager.ast

  Object.values(sceneEntitiesManager.activeSegments).forEach((segmentGroup) => {
    if (!SEGMENT_BODIES_PLUS_PROFILE_START.includes(segmentGroup?.name)) return
    const nodeMeta = getNodeFromPath<Node<CallExpressionKw>>(
      updated,
      segmentGroup.userData.pathToNode,
      ['CallExpressionKw']
    )
    if (err(nodeMeta)) return
    const node = nodeMeta.node
    const groupHasCursor = codeBasedSelections.some((selection) => {
      return isOverlap(
        selection?.codeRef?.range,
        topLevelRange(node.start, node.end)
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
  selections: SelectionToEngine[]
): WebSocketRequest[] {
  if (engineCommandManager.connection?.pingIntervalId === undefined) {
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

/**
 * Is the selection a single cursor in a sketch pipe expression chain?
 */
export function isSketchPipe(selectionRanges: Selections) {
  if (!isSingleCursorInPipe(selectionRanges, kclManager.ast)) return false
  return isCursorInSketchCommandRange(kclManager.artifactGraph, selectionRanges)
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
  selection?: Selections
): SelectionCountsByType | 'none' {
  const selectionsByType: SelectionCountsByType = new Map()
  if (
    !selection ||
    (!selection.graphSelections.length && !selection.otherSelections.length)
  )
    return 'none'

  function incrementOrInitializeSelectionType(type: ResolvedSelectionType) {
    const count = selectionsByType.get(type) || 0
    selectionsByType.set(type, count + 1)
  }

  selection.otherSelections.forEach((selection) => {
    if (typeof selection === 'string') {
      incrementOrInitializeSelectionType('other')
    } else if ('name' in selection) {
      incrementOrInitializeSelectionType('plane')
    }
  })

  selection.graphSelections.forEach((graphSelection) => {
    if (!graphSelection.artifact) {
      /**
       * TODO: remove this heuristic-based selection type detection.
       * Currently, if you've created a sketch and have not left sketch mode,
       * the selection will be a segment selection with no artifact.
       * This is because the mock execution does not update the artifact graph.
       * Once we move the artifactGraph creation to WASM, we can remove this,
       * as the artifactGraph will always be up-to-date.
       */
      if (isSingleCursorInPipe(selection, kclManager.ast)) {
        incrementOrInitializeSelectionType('segment')
        return
      } else {
        console.warn(
          'Selection is outside of a sketch but has no artifact. Sketch segment selections are the only kind that can have a valid selection with no artifact.',
          JSON.stringify(graphSelection)
        )
        incrementOrInitializeSelectionType('other')
        return
      }
    }
    incrementOrInitializeSelectionType(graphSelection.artifact.type)
  })

  return selectionsByType
}

export function getSelectionTypeDisplayText(
  selection?: Selections
): string | null {
  const selectionsByType = getSelectionCountByType(selection)
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
  return (
    selectionsByType !== 'none' &&
    [...selectionsByType.entries()].every(([type, count]) => {
      const foundIndex = argument.selectionTypes.findIndex((s) => s === type)
      return (
        foundIndex !== -1 &&
        (!argument.multiple ? count < 2 && count > 0 : count > 0)
      )
    })
  )
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
    if (['plane', 'cap', 'wall', 'sweep'].includes(entry.artifact.type)) {
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

export async function sendSelectEventToEngine(
  e: React.MouseEvent<HTMLDivElement, MouseEvent>,
  videoRef: HTMLVideoElement
) {
  const { x, y } = getNormalisedCoordinates(
    e,
    videoRef,
    engineCommandManager.streamDimensions
  )
  let res = await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd: {
      type: 'select_with_point',
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
    const mr = singleRes.resp.data.modeling_response
    if (mr.type === 'select_with_point') return mr.data
  }
  return { entity_id: '' }
}

export function updateSelections(
  pathToNodeMap: PathToNodeMap,
  prevSelectionRanges: Selections,
  ast: Program | Error
): Selections | Error {
  if (err(ast)) return ast

  const newSelections = Object.entries(pathToNodeMap)
    .map(([index, pathToNode]): Selection | undefined => {
      const previousSelection =
        prevSelectionRanges.graphSelections[Number(index)]
      const nodeMeta = getNodeFromPath<Expr>(ast, pathToNode)
      if (err(nodeMeta)) return undefined
      const node = nodeMeta.node
      let artifact: Artifact | null = null
      for (const [id, a] of kclManager.artifactGraph) {
        if (previousSelection?.artifact?.type === a.type) {
          const codeRefs = getCodeRefsByArtifactId(id, kclManager.artifactGraph)
          if (!codeRefs) continue
          if (
            JSON.stringify(codeRefs[0].pathToNode) ===
            JSON.stringify(pathToNode)
          ) {
            artifact = a
            break
          }
        }
      }
      if (!artifact) return undefined
      return {
        artifact: artifact,
        codeRef: {
          range: topLevelRange(node.start, node.end),
          pathToNode: pathToNode,
        },
      }
    })
    .filter((x?: Selection) => x !== undefined)

  // for when there is no artifact (sketch mode since mock execute does not update artifactGraph)
  const pathToNodeBasedSelections: Selections['graphSelections'] = []
  for (const pathToNode of Object.values(pathToNodeMap)) {
    const node = getNodeFromPath<Expr>(ast, pathToNode)
    if (err(node)) return node
    pathToNodeBasedSelections.push({
      codeRef: {
        range: topLevelRange(node.node.start, node.node.end),
        pathToNode: pathToNode,
      },
    })
  }

  return {
    graphSelections:
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
  defaultPlaneId: string
): Error | false | DefaultPlane {
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
export function selectDefaultSketchPlane(
  defaultPlaneId: string
): Error | boolean {
  const result = getDefaultSketchPlaneData(defaultPlaneId)
  if (err(result) || result === false) return result
  sceneInfra.modelingSend({
    type: 'Select sketch plane',
    data: result,
  })
  return true
}

export async function getOffsetSketchPlaneData(
  artifact: Artifact | undefined
): Promise<Error | false | OffsetPlane> {
  if (artifact?.type !== 'plane') {
    return new Error(
      `Invalid artifact type for offset sketch plane selection: ${artifact?.type}`
    )
  }
  const planeId = artifact.id
  try {
    const planeInfo = await sceneEntitiesManager.getFaceDetails(planeId)

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
  artifact: Artifact | undefined
): Promise<Error | boolean> {
  const result = await getOffsetSketchPlaneData(artifact)
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
  planeOrFaceId: ArtifactId
): Promise<ExtrudeFacePlane | undefined> {
  const defaultSketchPlaneSelected = selectDefaultSketchPlane(planeOrFaceId)
  if (!err(defaultSketchPlaneSelected) && defaultSketchPlaneSelected) {
    return
  }

  const artifact = kclManager.artifactGraph.get(planeOrFaceId)
  const offsetPlaneSelected = await selectOffsetSketchPlane(artifact)
  if (!err(offsetPlaneSelected) && offsetPlaneSelected) {
    return
  }

  // Artifact is likely an sweep face
  const faceId = planeOrFaceId
  const extrusion = getSweepFromSuspectedSweepSurface(
    faceId,
    kclManager.artifactGraph
  )
  if (!err(extrusion)) {
    if (!isTopLevelModule(extrusion.codeRef.range)) {
      const moduleId = getModuleId(extrusion.codeRef.range)
      const importDetails = kclManager.execState.filenames[moduleId]
      if (!importDetails) {
        toast.error("can't sketch on this face")
        return
      }
      if (importDetails?.type === 'Local') {
        // importDetails has OS specific separators from the rust side!
        const fileNameWithExtension = getStringAfterLastSeparator(
          importDetails.value
        )
        showSketchOnImportToast(fileNameWithExtension)
      } else if (
        importDetails?.type === 'Main' ||
        importDetails?.type === 'Std'
      ) {
        toast.error("can't sketch on this face")
      } else {
        // force tsc error if more cases are added
        const _exhaustiveCheck: never = importDetails
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
      ? getCapCodeRef(artifact, kclManager.artifactGraph)
      : artifact.type === 'wall'
        ? getWallCodeRef(artifact, kclManager.artifactGraph)
        : artifact.codeRef

  const faceInfo = await sceneEntitiesManager.getFaceDetails(faceId)
  if (!faceInfo?.origin || !faceInfo?.z_axis || !faceInfo?.y_axis) return
  const { z_axis, y_axis, origin } = faceInfo
  const sketchPathToNode = err(codeRef) ? [] : codeRef.pathToNode

  const edgeCutMeta = getEdgeCutMeta(
    artifact,
    kclManager.ast,
    kclManager.artifactGraph
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
    kclManager.artifactGraph
  )
  const lastChildVariable = getLastVariable(children, kclManager.ast, [
    'sweep',
    'compositeSolid',
  ])
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

export function selectAllInCurrentSketch(): Selections {
  const graphSelections: Selection[] = []

  const artifactGraph = kclManager.artifactGraph
  Object.keys(sceneEntitiesManager.activeSegments).forEach((pathToNode) => {
    const artifact = artifactGraph
      .values()
      .find(
        (g) =>
          'codeRef' in g && JSON.stringify(g.codeRef.pathToNode) === pathToNode
      )
    if (artifact && ['path', 'segment'].includes(artifact.type)) {
      const codeRefs = getCodeRefsByArtifactId(artifact.id, artifactGraph)
      if (codeRefs?.length) {
        graphSelections.push({ artifact, codeRef: codeRefs[0] })
      }
    }
  })

  return {
    graphSelections,
    otherSelections: [],
  }
}
