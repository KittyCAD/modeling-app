import type { SelectionRange } from '@codemirror/state'
import { EditorSelection } from '@codemirror/state'
import type { Models } from '@kittycad/lib'
import type { Object3D, Object3DEventMap } from 'three'
import { Mesh } from 'three'

import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  SEGMENT_BODIES_PLUS_PROFILE_START,
  getParentGroup,
} from '@src/clientSideScene/sceneConstants'
import { AXIS_GROUP, X_AXIS } from '@src/clientSideScene/sceneUtils'
import { getNodeFromPath, isSingleCursorInPipe } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type { Artifact, ArtifactId, CodeRef } from '@src/lang/std/artifactGraph'
import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'
import type { PathToNodeMap } from '@src/lang/std/sketchcombos'
import { isCursorInSketchCommandRange, topLevelRange } from '@src/lang/util'
import type {
  ArtifactGraph,
  CallExpressionKw,
  Expr,
  Program,
  SourceRange,
} from '@src/lang/wasm'
import { defaultSourceRange } from '@src/lang/wasm'
import type { ArtifactEntry, ArtifactIndex } from '@src/lib/artifactIndex'
import type { CommandArgument } from '@src/lib/commandTypes'
import type { DefaultPlaneStr } from '@src/lib/planes'
import {
  codeManager,
  engineCommandManager,
  kclManager,
  rustContext,
  sceneEntitiesManager,
} from '@src/lib/singletons'
import { err } from '@src/lib/trap'
import {
  getNormalisedCoordinates,
  isArray,
  isNonNullable,
  isOverlap,
  uuidv4,
} from '@src/lib/utils'
import { engineStreamActor } from '@src/lib/singletons'
import type { ModelingMachineEvent } from '@src/machines/modelingMachine'
import { showUnsupportedSelectionToast } from '@src/components/ToastUnsupportedSelection'

export const X_AXIS_UUID = 'ad792545-7fd3-482a-a602-a93924e3055b'
export const Y_AXIS_UUID = '680fd157-266f-4b8a-984f-cdf46b8bdf01'

export type Axis = 'y-axis' | 'x-axis' | 'z-axis'
export type DefaultPlaneSelection = {
  name: DefaultPlaneStr
  id: string
}

export type NonCodeSelection = Axis | DefaultPlaneSelection
export interface Selection {
  artifact?: Artifact
  codeRef: CodeRef
}
export type Selections = {
  otherSelections: Array<NonCodeSelection>
  graphSelections: Array<Selection>
}

export async function getEventForSelectWithPoint({
  data,
}: Extract<
  Models['OkModelingCmdResponse_type'],
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
  engineEvents: Models['WebSocketRequest_type'][]
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
  const engineEvents: Models['WebSocketRequest_type'][] =
    resetAndSetEngineEntitySelectionCmds(selectionToEngine)
  selections.graphSelections.forEach(({ codeRef }) => {
    if (codeRef.range?.[1]) {
      const safeEnd = Math.min(codeRef.range[1], codeManager.code.length)
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
      [EditorSelection.cursor(codeManager.code.length)],
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
  engineEvents: Models['WebSocketRequest_type'][]
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
      ? 0x0000ff
      : segmentGroup?.userData?.baseColor || 0xffffff
    segmentGroup.traverse(
      (child) => child instanceof Mesh && child.material.color.set(color)
    )
    // TODO if we had access to the xstate context and therefore selections
    // we wouldn't need to set this here,
    // it would be better to treat xstate context as the source of truth instead of having
    // extra redundant state floating around
    segmentGroup.userData.isSelected = groupHasCursor
  })
}

function resetAndSetEngineEntitySelectionCmds(
  selections: SelectionToEngine[]
): Models['WebSocketRequest_type'][] {
  if (!engineCommandManager.engineConnection?.isReady()) {
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
        `${count} ${type.replace('wall', 'face').replace('solid2d', 'face')}${
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
 * Find the index of the last range where range[0] < targetStart
 * This is used as a starting point for linear search of overlapping ranges
 * @param index The sorted array of ranges to search through
 * @param targetStart The start position to compare against
 * @returns The index of the last range where range[0] < targetStart
 */
export function findLastRangeStartingBefore(
  index: ArtifactIndex,
  targetStart: number
): number {
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

  return lastValidIndex
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

  // TODO: We think the problem is here?
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
      console.warn('ADAM: Selection', selection)
      console.warn('ADAM: codeRef', selection.codeRef)
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
  e: React.MouseEvent<HTMLDivElement, MouseEvent>
) {
  // No video stream to normalise against, return immediately
  const engineStreamState = engineStreamActor.getSnapshot().context
  if (!engineStreamState.videoRef.current)
    return Promise.reject('video element not ready')

  const { x, y } = getNormalisedCoordinates(
    e,
    engineStreamState.videoRef.current,
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
    return Promise.reject('no response')
  }

  if (isArray(res)) {
    res = res[0]
  }
  if (
    res?.success &&
    res?.resp?.type === 'modeling' &&
    res?.resp?.data?.modeling_response.type === 'select_with_point'
  )
    return res?.resp?.data?.modeling_response?.data
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
