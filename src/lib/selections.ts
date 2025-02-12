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
  getArtifactOfTypes,
  getArtifactsOfTypes,
  getCapCodeRef,
  getSweepEdgeCodeRef,
  getSolid2dCodeRef,
  getWallCodeRef,
  CodeRef,
  getCodeRefsByArtifactId,
  ArtifactId,
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

/** @deprecated Use {@link Artifact} instead. */
type Selection__old =
  | {
      type:
        | 'default'
        | 'line-end'
        | 'line-mid'
        | 'extrude-wall'
        | 'solid2d'
        | 'start-cap'
        | 'end-cap'
        | 'point'
        | 'edge'
        | 'adjacent-edge'
        | 'line'
        | 'arc'
        | 'all'
      range: SourceRange
    }
  | {
      type: 'opposite-edgeCut' | 'adjacent-edgeCut' | 'base-edgeCut'
      range: SourceRange
      // TODO this is a temporary measure that well be made redundant with: https://github.com/KittyCAD/modeling-app/pull/3836
      secondaryRange: SourceRange
    }
export type NonCodeSelection = Axis | DefaultPlaneSelection

/** @deprecated Use {@link Selection} instead. */
export type Selections__old = {
  otherSelections: NonCodeSelection[]
  codeBasedSelections: Selection__old[]
}
export interface Selection {
  artifact?: Artifact
  codeRef: CodeRef
}
export type Selections = {
  otherSelections: Array<NonCodeSelection>
  graphSelections: Array<Selection>
}

/** @deprecated If you're writing a new function, it should use {@link Selection} and not {@link Selection__old}
 * this function should only be used for backwards compatibility with old functions.
 */
function convertSelectionToOld(selection: Selection): Selection__old | null {
  // return {} as Selection__old
  // TODO implementation
  const _artifact = selection.artifact
  if (_artifact?.type === 'solid2d') {
    const codeRef = getSolid2dCodeRef(
      _artifact,
      engineCommandManager.artifactGraph
    )
    if (err(codeRef)) return null
    return { range: codeRef.range, type: 'solid2d' }
  }
  if (_artifact?.type === 'cap') {
    const codeRef = getCapCodeRef(_artifact, engineCommandManager.artifactGraph)
    if (err(codeRef)) return null
    return {
      range: codeRef.range,
      type: _artifact?.subType === 'end' ? 'end-cap' : 'start-cap',
    }
  }
  if (_artifact?.type === 'wall') {
    const codeRef = getWallCodeRef(
      _artifact,
      engineCommandManager.artifactGraph
    )
    if (err(codeRef)) return null
    return { range: codeRef.range, type: 'extrude-wall' }
  }
  if (_artifact?.type === 'segment' || _artifact?.type === 'path') {
    return { range: _artifact.codeRef.range, type: 'default' }
  }
  if (_artifact?.type === 'sweepEdge') {
    const codeRef = getSweepEdgeCodeRef(
      _artifact,
      engineCommandManager.artifactGraph
    )
    if (err(codeRef)) return null
    if (_artifact?.subType === 'adjacent') {
      return { range: codeRef.range, type: 'adjacent-edge' }
    }
    return { range: codeRef.range, type: 'edge' }
  }
  if (_artifact?.type === 'edgeCut') {
    const codeRef = _artifact.codeRef
    return { range: codeRef.range, type: 'default' }
  }
  if (selection?.codeRef?.range) {
    return { range: selection.codeRef.range, type: 'default' }
  }
  return null
}
/** @deprecated If you're writing a new function, it should use {@link Selection} and not {@link Selection__old}
 * this function should only be used for backwards compatibility with old functions.
 */
export function convertSelectionsToOld(selection: Selections): Selections__old {
  const selections: Selection__old[] = []
  for (const artifact of selection.graphSelections) {
    const converted = convertSelectionToOld(artifact)
    if (converted) selections.push(converted)
  }
  const selectionsOld: Selections__old = {
    otherSelections: selection.otherSelections,
    codeBasedSelections: selections,
  }
  return selectionsOld
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
        type: 'default',
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
  type: Selection__old['type']
  id?: string
  range: SourceRange
}

export function processCodeMirrorRanges({
  codeMirrorRanges,
  selectionRanges,
  isShiftDown,
  ast,
}: {
  codeMirrorRanges: readonly SelectionRange[]
  selectionRanges: Selections
  isShiftDown: boolean
  ast: Program
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
  const idBasedSelections: SelectionToEngine[] =
    codeToIdSelections(codeBasedSelections)
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
    const artifact = engineCommandManager.artifactGraph.get(id)
    const codeRefs = getCodeRefsByArtifactId(
      id,
      engineCommandManager.artifactGraph
    )
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

export function codeToIdSelections(
  selections: Selection[]
): SelectionToEngine[] {
  const selectionsOld = convertSelectionsToOld({
    graphSelections: selections,
    otherSelections: [],
  }).codeBasedSelections
  return selectionsOld
    .flatMap((selection): null | SelectionToEngine[] => {
      const { type } = selection
      // TODO #868: loops over all artifacts will become inefficient at a large scale
      const overlappingEntries = Array.from(engineCommandManager.artifactGraph)
        .map(([id, artifact]) => {
          const codeRef =
            'codeRef' in artifact
              ? artifact.codeRef
              : 'faceCodeRef' in artifact
              ? artifact.faceCodeRef
              : null
          if (!codeRef) return null
          return isOverlap(codeRef.range, selection.range)
            ? {
                artifact,
                selection,
                id,
              }
            : null
        })
        .filter(isNonNullable)

      /** TODO refactor
       * selections in our app is a sourceRange plus some metadata
       * The metadata is just a union type string of different types of artifacts or 3d features 'extrude-wall' 'segment' etc
       * Because the source range is not enough to figure out what the user selected, so here we're using filtering through all the artifacts
       * to find something that matches both the source range and the metadata.
       *
       * What we should migrate to is just storing what the user selected by what it matched in the artifactGraph it will simply the below a lot.
       *
       * In the case of a user moving the cursor them, we will still need to figure out what artifact from the graph matches best, but we will just need sane defaults
       * and most of the time we can expect the user to be clicking in the 3d scene instead.
       */
      let bestCandidate:
        | {
            id: ArtifactId
            artifact: unknown
            selection: Selection__old
          }
        | undefined
      overlappingEntries.forEach((entry) => {
        // TODO probably need to remove much of the `type === 'xyz'` below
        if (type === 'default' && entry.artifact.type === 'segment') {
          bestCandidate = entry
          return
        }
        if (entry.artifact.type === 'path') {
          const artifact = engineCommandManager.artifactGraph.get(
            entry.artifact.solid2dId || ''
          )
          if (artifact?.type !== 'solid2d') {
            bestCandidate = {
              artifact: entry.artifact,
              selection,
              id: entry.id,
            }
          }
          if (!entry.artifact.solid2dId) {
            console.error(
              'Expected PathArtifact to have solid2dId, but none found'
            )
            return
          }
          bestCandidate = {
            artifact: artifact,
            selection,
            id: entry.artifact.solid2dId,
          }
        }
        if (entry.artifact.type === 'plane') {
          bestCandidate = {
            artifact: entry.artifact,
            selection,
            id: entry.id,
          }
        }
        if (entry.artifact.type === 'cap') {
          bestCandidate = {
            artifact: entry.artifact,
            selection,
            id: entry.id,
          }
        }
        if (entry.artifact.type === 'wall') {
          bestCandidate = {
            artifact: entry.artifact,
            selection,
            id: entry.id,
          }
        }
        if (type === 'extrude-wall' && entry.artifact.type === 'segment') {
          if (!entry.artifact.surfaceId) return
          const wall = engineCommandManager.artifactGraph.get(
            entry.artifact.surfaceId
          )
          if (wall?.type !== 'wall') return
          bestCandidate = {
            artifact: wall,
            selection,
            id: entry.artifact.surfaceId,
          }
          return
        }
        if (type === 'edge' && entry.artifact.type === 'segment') {
          const edges = getArtifactsOfTypes(
            { keys: entry.artifact.edgeIds, types: ['sweepEdge'] },
            engineCommandManager.artifactGraph
          )
          const edge = [...edges].find(([_, edge]) => edge.type === 'sweepEdge')
          if (!edge) return
          bestCandidate = {
            artifact: edge[1],
            selection,
            id: edge[0],
          }
        }
        if (type === 'adjacent-edge' && entry.artifact.type === 'segment') {
          const edges = getArtifactsOfTypes(
            { keys: entry.artifact.edgeIds, types: ['sweepEdge'] },
            engineCommandManager.artifactGraph
          )
          const edge = [...edges].find(
            ([_, edge]) =>
              edge.type === 'sweepEdge' && edge.subType === 'adjacent'
          )
          if (!edge) return
          bestCandidate = {
            artifact: edge[1],
            selection,
            id: edge[0],
          }
        }
        if (
          (type === 'end-cap' || type === 'start-cap') &&
          entry.artifact.type === 'path'
        ) {
          if (!entry.artifact.sweepId) return
          const extrusion = getArtifactOfTypes(
            {
              key: entry.artifact.sweepId,
              types: ['sweep'],
            },
            engineCommandManager.artifactGraph
          )
          if (err(extrusion)) return
          const caps = getArtifactsOfTypes(
            { keys: extrusion.surfaceIds, types: ['cap'] },
            engineCommandManager.artifactGraph
          )
          const cap = [...caps].find(
            ([_, cap]) => cap.subType === (type === 'end-cap' ? 'end' : 'start')
          )
          if (!cap) return
          bestCandidate = {
            artifact: entry.artifact,
            selection,
            id: cap[0],
          }
          return
        }
        if (entry.artifact.type === 'edgeCut') {
          const consumedEdge = getArtifactOfTypes(
            {
              key: entry.artifact.consumedEdgeId,
              types: ['segment', 'sweepEdge'],
            },
            engineCommandManager.artifactGraph
          )
          if (err(consumedEdge)) return
          if (
            consumedEdge.type === 'segment' &&
            type === 'base-edgeCut' &&
            isOverlap(
              consumedEdge.codeRef.range,
              selection.secondaryRange || [0, 0]
            )
          ) {
            bestCandidate = {
              artifact: entry.artifact,
              selection,
              id: entry.id,
            }
          } else if (
            consumedEdge.type === 'sweepEdge' &&
            ((type === 'adjacent-edgeCut' &&
              consumedEdge.subType === 'adjacent') ||
              (type === 'opposite-edgeCut' &&
                consumedEdge.subType === 'opposite'))
          ) {
            const seg = getArtifactOfTypes(
              { key: consumedEdge.segId, types: ['segment'] },
              engineCommandManager.artifactGraph
            )
            if (err(seg)) return
            if (
              isOverlap(seg.codeRef.range, selection.secondaryRange || [0, 0])
            ) {
              bestCandidate = {
                artifact: entry.artifact,
                selection,
                id: entry.id,
              }
            }
          }
        }

        if (entry.artifact.type === 'sweep') {
          bestCandidate = {
            artifact: entry.artifact,
            selection,
            id: entry.id,
          }
        }
      })

      if (bestCandidate) {
        return [
          {
            type,
            id: bestCandidate.id,
            range: bestCandidate.selection.range,
          },
        ]
      }
      return [selection]
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
