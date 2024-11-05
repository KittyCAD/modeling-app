import { Models } from '@kittycad/lib'
import {
  codeManager,
  engineCommandManager,
  kclManager,
  sceneEntitiesManager,
} from 'lib/singletons'
import { CallExpression, SourceRange, Expr, parse } from 'lang/wasm'
import { ModelingMachineEvent } from 'machines/modelingMachine'
import { isNonNullable, uuidv4 } from 'lib/utils'
import { EditorSelection, SelectionRange } from '@codemirror/state'
import { getNormalisedCoordinates, isOverlap } from 'lib/utils'
import { isCursorInSketchCommandRange } from 'lang/util'
import { Program } from 'lang/wasm'
import {
  doesPipeHaveCallExp,
  getNodeFromPath,
  hasSketchPipeBeenExtruded,
  isSingleCursorInPipe,
} from 'lang/queryAst'
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
  getArtifactOfTypes,
  getArtifactsOfTypes,
  getCapCodeRef,
  getSweepEdgeCodeRef,
  getSolid2dCodeRef,
  getWallCodeRef,
  ArtifactId,
} from 'lang/std/artifactGraph'
import { Node } from 'wasm-lib/kcl/bindings/Node'

export const X_AXIS_UUID = 'ad792545-7fd3-482a-a602-a93924e3055b'
export const Y_AXIS_UUID = '680fd157-266f-4b8a-984f-cdf46b8bdf01'

export type Axis = 'y-axis' | 'x-axis' | 'z-axis'

export type Selection =
  | {
      type:
        | 'default'
        | 'line-end'
        | 'line-mid'
        | 'extrude-wall'
        | 'solid2D'
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
export type Selections = {
  otherSelections: Axis[]
  codeBasedSelections: Selection[]
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
        selectionType: 'otherSelection',
        selection: X_AXIS_UUID === data.entity_id ? 'x-axis' : 'y-axis',
      },
    }
  }
  let _artifact = engineCommandManager.artifactGraph.get(data.entity_id)
  if (!_artifact)
    return {
      type: 'Set selection',
      data: { selectionType: 'singleCodeCursor' },
    }
  if (_artifact.type === 'solid2D') {
    const codeRef = getSolid2dCodeRef(
      _artifact,
      engineCommandManager.artifactGraph
    )
    if (err(codeRef)) return null
    return {
      type: 'Set selection',
      data: {
        selectionType: 'singleCodeCursor',
        selection: { range: codeRef.range, type: 'solid2D' },
      },
    }
  }
  if (_artifact.type === 'cap') {
    const codeRef = getCapCodeRef(_artifact, engineCommandManager.artifactGraph)
    if (err(codeRef)) return null
    return {
      type: 'Set selection',
      data: {
        selectionType: 'singleCodeCursor',
        selection: {
          range: codeRef.range,
          type: _artifact?.subType === 'end' ? 'end-cap' : 'start-cap',
        },
      },
    }
  }
  if (_artifact.type === 'wall') {
    const codeRef = getWallCodeRef(
      _artifact,
      engineCommandManager.artifactGraph
    )
    if (err(codeRef)) return null
    return {
      type: 'Set selection',
      data: {
        selectionType: 'singleCodeCursor',
        selection: { range: codeRef.range, type: 'extrude-wall' },
      },
    }
  }
  if (_artifact.type === 'segment' || _artifact.type === 'path') {
    return {
      type: 'Set selection',
      data: {
        selectionType: 'singleCodeCursor',
        selection: { range: _artifact.codeRef.range, type: 'default' },
      },
    }
  }
  if (_artifact.type === 'sweepEdge') {
    const codeRef = getSweepEdgeCodeRef(
      _artifact,
      engineCommandManager.artifactGraph
    )
    if (err(codeRef)) return null
    if (_artifact?.subType === 'adjacent') {
      return {
        type: 'Set selection',
        data: {
          selectionType: 'singleCodeCursor',
          selection: { range: codeRef.range, type: 'adjacent-edge' },
        },
      }
    }
    return {
      type: 'Set selection',
      data: {
        selectionType: 'singleCodeCursor',
        selection: { range: codeRef.range, type: 'edge' },
      },
    }
  }
  if (_artifact.type === 'edgeCut') {
    const consumedEdge = getArtifactOfTypes(
      { key: _artifact.consumedEdgeId, types: ['segment', 'sweepEdge'] },
      engineCommandManager.artifactGraph
    )
    if (err(consumedEdge))
      return {
        type: 'Set selection',
        data: {
          selectionType: 'singleCodeCursor',
          selection: { range: _artifact.codeRef.range, type: 'default' },
        },
      }
    if (consumedEdge.type === 'segment') {
      return {
        type: 'Set selection',
        data: {
          selectionType: 'singleCodeCursor',
          selection: {
            range: _artifact.codeRef.range,
            type: 'base-edgeCut',
            secondaryRange: consumedEdge.codeRef.range,
          },
        },
      }
    }
    const segment = getArtifactOfTypes(
      { key: consumedEdge.segId, types: ['segment'] },
      engineCommandManager.artifactGraph
    )
    if (err(segment)) return null
    return {
      type: 'Set selection',
      data: {
        selectionType: 'singleCodeCursor',
        selection: {
          range: _artifact.codeRef.range,
          type:
            consumedEdge.subType === 'adjacent'
              ? 'adjacent-edgeCut'
              : 'opposite-edgeCut',
          secondaryRange: segment.codeRef.range,
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
        selectionType: 'otherSelection',
        selection: obj?.userData?.type === X_AXIS ? 'x-axis' : 'y-axis',
      },
    }
  }
  const pathToNode = group?.userData?.pathToNode
  if (!pathToNode) return null
  // previous drags don't update ast for efficiency reasons
  // So we want to make sure we have and updated ast with
  // accurate source ranges
  const updatedAst = parse(codeManager.code)
  if (err(updatedAst)) return null

  const nodeMeta = getNodeFromPath<Node<CallExpression>>(
    updatedAst,
    pathToNode,
    'CallExpression'
  )
  if (err(nodeMeta)) return null

  const node = nodeMeta.node
  const range: SourceRange = [node.start, node.end]
  return {
    type: 'Set selection',
    data: {
      selectionType: 'singleCodeCursor',
      selection: { range, type: 'default' },
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
  otherSelections: Axis[]
  updateSceneObjectColors: () => void
} {
  const ranges: ReturnType<typeof EditorSelection.cursor>[] = []
  const engineEvents: Models['WebSocketRequest_type'][] =
    resetAndSetEngineEntitySelectionCmds(
      codeToIdSelections(selections.codeBasedSelections)
    )
  selections.codeBasedSelections.forEach(({ range, type }) => {
    if (range?.[1]) {
      ranges.push(EditorSelection.cursor(range[1]))
    }
  })
  if (ranges.length)
    return {
      engineEvents,
      codeMirrorSelection: EditorSelection.create(
        ranges,
        selections.codeBasedSelections.length - 1
      ),
      otherSelections: selections.otherSelections,
      updateSceneObjectColors: () =>
        updateSceneObjectColors(selections.codeBasedSelections),
    }

  return {
    codeMirrorSelection: EditorSelection.create(
      [EditorSelection.cursor(codeManager.code.length)],
      0
    ),
    engineEvents,
    otherSelections: selections.otherSelections,
    updateSceneObjectColors: () =>
      updateSceneObjectColors(selections.codeBasedSelections),
  }
}

type SelectionToEngine = { type: Selection['type']; id: string }

export function processCodeMirrorRanges({
  codeMirrorRanges,
  selectionRanges,
  isShiftDown,
}: {
  codeMirrorRanges: readonly SelectionRange[]
  selectionRanges: Selections
  isShiftDown: boolean
}): null | {
  modelingEvent: ModelingMachineEvent
  engineEvents: Models['WebSocketRequest_type'][]
} {
  const isChange =
    codeMirrorRanges.length !== selectionRanges.codeBasedSelections.length ||
    codeMirrorRanges.some(({ from, to }, i) => {
      return (
        from !== selectionRanges.codeBasedSelections[i].range[0] ||
        to !== selectionRanges.codeBasedSelections[i].range[1]
      )
    })

  if (!isChange) return null
  const codeBasedSelections: Selections['codeBasedSelections'] =
    codeMirrorRanges.map(({ from, to }) => {
      return {
        type: 'default',
        range: [from, to],
      }
    })
  const idBasedSelections: SelectionToEngine[] =
    codeToIdSelections(codeBasedSelections)

  if (!selectionRanges) return null
  updateSceneObjectColors(codeBasedSelections)
  return {
    modelingEvent: {
      type: 'Set selection',
      data: {
        selectionType: 'mirrorCodeMirrorSelections',
        selection: {
          otherSelections: isShiftDown ? selectionRanges.otherSelections : [],
          codeBasedSelections,
        },
      },
    },
    engineEvents: resetAndSetEngineEntitySelectionCmds(idBasedSelections),
  }
}

function updateSceneObjectColors(codeBasedSelections: Selection[]) {
  const updated = kclManager.ast

  Object.values(sceneEntitiesManager.activeSegments).forEach((segmentGroup) => {
    if (!SEGMENT_BODIES_PLUS_PROFILE_START.includes(segmentGroup?.name)) return
    const nodeMeta = getNodeFromPath<Node<CallExpression>>(
      updated,
      segmentGroup.userData.pathToNode,
      'CallExpression'
    )
    if (err(nodeMeta)) return
    const node = nodeMeta.node
    const groupHasCursor = codeBasedSelections.some((selection) => {
      return isOverlap(selection.range, [node.start, node.end])
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
        entities: selections.map(({ id }) => id),
      },
      cmd_id: uuidv4(),
    },
  ]
}

export function isSketchPipe(selectionRanges: Selections) {
  if (!isSingleCursorInPipe(selectionRanges, kclManager.ast)) return false
  return isCursorInSketchCommandRange(
    engineCommandManager.artifactGraph,
    selectionRanges
  )
}

export function isSelectionLastLine(
  selectionRanges: Selections,
  code: string,
  i = 0
) {
  return selectionRanges.codeBasedSelections[i].range[1] === code.length
}

export function isRangeBetweenCharacters(selectionRanges: Selections) {
  return (
    selectionRanges.codeBasedSelections.length === 1 &&
    selectionRanges.codeBasedSelections[0].range[0] === 0 &&
    selectionRanges.codeBasedSelections[0].range[1] === 0
  )
}

export type CommonASTNode = {
  selection: Selection
  ast: Program
}

function buildCommonNodeFromSelection(selectionRanges: Selections, i: number) {
  return {
    selection: selectionRanges.codeBasedSelections[i],
    ast: kclManager.ast,
  }
}

function nodeHasExtrude(node: CommonASTNode) {
  return (
    doesPipeHaveCallExp({
      calleeName: 'extrude',
      ...node,
    }) ||
    doesPipeHaveCallExp({
      calleeName: 'revolve',
      ...node,
    })
  )
}

function nodeHasClose(node: CommonASTNode) {
  return doesPipeHaveCallExp({
    calleeName: 'close',
    ...node,
  })
}
function nodeHasCircle(node: CommonASTNode) {
  return doesPipeHaveCallExp({
    calleeName: 'circle',
    ...node,
  })
}

export function canSweepSelection(selection: Selections) {
  const commonNodes = selection.codeBasedSelections.map((_, i) =>
    buildCommonNodeFromSelection(selection, i)
  )
  return (
    !!isSketchPipe(selection) &&
    commonNodes.every((n) => !hasSketchPipeBeenExtruded(n.selection, n.ast)) &&
    (commonNodes.every((n) => nodeHasClose(n)) ||
      commonNodes.every((n) => nodeHasCircle(n))) &&
    commonNodes.every((n) => !nodeHasExtrude(n))
  )
}

export function canFilletSelection(selection: Selections) {
  const commonNodes = selection.codeBasedSelections.map((_, i) =>
    buildCommonNodeFromSelection(selection, i)
  ) // TODO FILLET DUMMY PLACEHOLDER
  return (
    !!isSketchPipe(selection) &&
    commonNodes.every((n) => nodeHasClose(n)) &&
    commonNodes.every((n) => !nodeHasExtrude(n))
  )
}

function canExtrudeSelectionItem(selection: Selections, i: number) {
  const isolatedSelection = {
    ...selection,
    codeBasedSelections: [selection.codeBasedSelections[i]],
  }
  const commonNode = buildCommonNodeFromSelection(selection, i)

  return (
    !!isSketchPipe(isolatedSelection) &&
    (nodeHasClose(commonNode) || nodeHasCircle(commonNode)) &&
    !nodeHasExtrude(commonNode)
  )
}

// This accounts for non-geometry selections under "other"
export type ResolvedSelectionType = [Selection['type'] | 'other', number]

/**
 * In the future, I'd like this function to properly return the type of each selected entity based on
 * its code source range, so that we can show something like "0 objects" or "1 face" or "1 line, 2 edges",
 * and then validate the selection in CommandBarSelectionInput.tsx and show the proper label.
 * @param selection
 * @returns
 */
export function getSelectionType(
  selection?: Selections
): ResolvedSelectionType[] {
  if (!selection) return []
  const extrudableCount = selection.codeBasedSelections.filter((_, i) => {
    const singleSelection = {
      ...selection,
      codeBasedSelections: [selection.codeBasedSelections[i]],
    }
    return canExtrudeSelectionItem(singleSelection, 0)
  }).length

  return extrudableCount === selection.codeBasedSelections.length
    ? [['extrude-wall', extrudableCount]]
    : [['other', selection.codeBasedSelections.length]]
}

export function getSelectionTypeDisplayText(
  selection?: Selections
): string | null {
  const selectionsByType = getSelectionType(selection)

  return (selectionsByType as Exclude<typeof selectionsByType, 'none'>)
    .map(
      // Hack for showing "face" instead of "extrude-wall" in command bar text
      ([type, count]) =>
        `${count} ${type.replace('extrude-wall', 'face')}${
          count > 1 ? 's' : ''
        }`
    )
    .join(', ')
}

export function canSubmitSelectionArg(
  selectionsByType: 'none' | ResolvedSelectionType[],
  argument: CommandArgument<unknown> & { inputType: 'selection' }
) {
  return (
    selectionsByType !== 'none' &&
    selectionsByType.every(([type, count]) => {
      const foundIndex = argument.selectionTypes.findIndex((s) => s === type)
      return (
        foundIndex !== -1 &&
        (!argument.multiple ? count < 2 && count > 0 : count > 0)
      )
    })
  )
}

function codeToIdSelections(
  codeBasedSelections: Selection[]
): SelectionToEngine[] {
  return codeBasedSelections
    .flatMap((selection): null | SelectionToEngine[] => {
      const { type } = selection
      // TODO #868: loops over all artifacts will become inefficient at a large scale
      const overlappingEntries = Array.from(engineCommandManager.artifactGraph)
        .map(([id, artifact]) => {
          if (!('codeRef' in artifact)) return null
          return isOverlap(artifact.codeRef.range, selection.range)
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
            selection: Selection
          }
        | undefined
      overlappingEntries.forEach((entry) => {
        if (type === 'default' && entry.artifact.type === 'segment') {
          bestCandidate = entry
          return
        }
        if (type === 'solid2D' && entry.artifact.type === 'path') {
          const solid = engineCommandManager.artifactGraph.get(
            entry.artifact.solid2dId || ''
          )
          if (solid?.type !== 'solid2D') return
          if (!entry.artifact.solid2dId) {
            console.error(
              'Expected PathArtifact to have solid2dId, but none found'
            )
            return
          }
          bestCandidate = {
            artifact: solid,
            selection,
            id: entry.artifact.solid2dId,
          }
        }
        if (type === 'extrude-wall' && entry.artifact.type === 'segment') {
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
      })

      if (bestCandidate) {
        return [
          {
            type,
            id: bestCandidate.id,
          },
        ]
      }
      return null
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
    streamWidth: el.clientWidth,
    streamHeight: el.clientHeight,
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
      const nodeMeta = getNodeFromPath<Expr>(ast, pathToNode)
      if (err(nodeMeta)) return undefined
      const node = nodeMeta.node
      const selection = prevSelectionRanges.codeBasedSelections[Number(index)]
      if (
        selection?.type === 'base-edgeCut' ||
        selection?.type === 'adjacent-edgeCut' ||
        selection?.type === 'opposite-edgeCut'
      )
        return {
          range: [node.start, node.end],
          type: selection?.type,
          secondaryRange: selection?.secondaryRange,
        }
      return {
        range: [node.start, node.end],
        type: selection?.type,
      }
    })
    .filter((x?: Selection) => x !== undefined) as Selection[]

  return {
    codeBasedSelections:
      newSelections.length > 0
        ? newSelections
        : prevSelectionRanges.codeBasedSelections,
    otherSelections: prevSelectionRanges.otherSelections,
  }
}
