import { Models } from '@kittycad/lib'
import {
  codeManager,
  engineCommandManager,
  kclManager,
  sceneEntitiesManager,
} from 'lib/singletons'
import {
  CallExpression,
  SourceRange,
  Expr,
  defaultSourceRange,
  topLevelRange,
  ArtifactGraph,
} from 'lang/wasm'
import { ModelingMachineEvent } from 'machines/modelingMachine'
import { isNonNullable, uuidv4 } from 'lib/utils'
import { EditorSelection, SelectionRange } from '@codemirror/state'
import { getNormalisedCoordinates, isOverlap } from 'lib/utils'
import { isCursorInSketchCommandRange } from 'lang/util'
import { Program } from 'lang/wasm'
import { getNodeFromPath, isSingleCursorInPipe } from 'lang/queryAst'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import { CommandArgument } from './commandTypes'
import {
  getParentGroup,
  SEGMENT_BODIES_PLUS_PROFILE_START,
} from 'clientSideScene/sceneEntities'
import { Mesh, Object3D, Object3DEventMap } from 'three'
import { AXIS_GROUP, X_AXIS } from 'clientSideScene/sceneInfra'
import { PathToNodeMap } from 'lang/std/sketchcombos'
import { err } from 'lib/trap'
import {
  Artifact,
  CodeRef,
  getCodeRefsByArtifactId,
  ArtifactId,
  getFaceCodeRef,
} from 'lang/std/artifactGraph'
import { Node } from 'wasm-lib/kcl/bindings/Node'
import { DefaultPlaneStr } from './planes'

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
    engineCommandManager.defaultPlanes !== null &&
    Object.entries(engineCommandManager.defaultPlanes).find(
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

  let _artifact = engineCommandManager.artifactGraph.get(data.entity_id)
  const codeRefs = getCodeRefsByArtifactId(
    data.entity_id,
    engineCommandManager.artifactGraph
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
  const segWithMatchingPathToNode__Id = [
    ...engineCommandManager.artifactGraph,
  ].find((entry) => {
    return (
      entry[1].type === 'segment' &&
      JSON.stringify(entry[1].codeRef.pathToNode) ===
        JSON.stringify(group?.userData?.pathToNode)
    )
  })?.[0]

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
  const artifact = engineCommandManager.artifactGraph.get(id)
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
          getCodeRefsByArtifactId(
            artifact.id,
            engineCommandManager.artifactGraph
          )?.[0].range || defaultSourceRange(),
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
    artifactGraph
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
    const nodeMeta = getNodeFromPath<Node<CallExpression | CallExpression>>(
      updated,
      segmentGroup.userData.pathToNode,
      ['CallExpression', 'CallExpressionKw']
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
  return isCursorInSketchCommandRange(
    engineCommandManager.artifactGraph,
    selectionRanges
  )
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
  argument: CommandArgument<unknown> & { inputType: 'selection' }
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

type ArtifactEntry = { artifact: Artifact; id: ArtifactId }

function findOverlappingArtifacts(
  selection: Selection,
  artifactGraph: ArtifactGraph
): ArtifactEntry[] {
  return Array.from(artifactGraph)
    .map(([id, artifact]) => {
      const codeRef = getFaceCodeRef(artifact)
      if (!codeRef) return null
      return isOverlap(codeRef.range, selection.codeRef.range)
        ? { artifact, id }
        : null
    })
    .filter(isNonNullable)
}

function getBestCandidate(
  entries: ArtifactEntry[],
  artifactGraph: ArtifactGraph
): ArtifactEntry | undefined {
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
    range: selection.codeRef.range
  }
}

export function codeToIdSelections(
  selections: Selection[],
  artifactGraph: ArtifactGraph
): SelectionToEngine[] {
  return selections
    .flatMap((selection): SelectionToEngine[] => {
      // Direct artifact case
      if (selection.artifact?.id) {
        return [createSelectionToEngine(selection, selection.artifact.id)]
      }

      // Find matching artifacts by code range overlap
      const overlappingEntries = findOverlappingArtifacts(selection, artifactGraph)
      const bestCandidate = getBestCandidate(overlappingEntries, artifactGraph)

      return [createSelectionToEngine(selection, bestCandidate?.id)]
    })
    .filter(isNonNullable)
}

export async function sendSelectEventToEngine(
  e: MouseEvent | React.MouseEvent<HTMLDivElement, MouseEvent>,
  el: HTMLVideoElement
) {
  const { x, y } = getNormalisedCoordinates({
    clientX: e.clientX,
    clientY: e.clientY,
    el,
    streamWidth: engineCommandManager.width,
    streamHeight: engineCommandManager.height,
  })
  const res = await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd: {
      type: 'select_with_point',
      selected_at_window: { x, y },
      selection_type: 'add',
    },
    cmd_id: uuidv4(),
  })
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
      for (const [id, a] of engineCommandManager.artifactGraph) {
        if (previousSelection?.artifact?.type === a.type) {
          const codeRefs = getCodeRefsByArtifactId(
            id,
            engineCommandManager.artifactGraph
          )
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
    .filter((x?: Selection) => x !== undefined) as Selection[]

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
