import { Models } from '@kittycad/lib'
import {
  codeManager,
  engineCommandManager,
  kclManager,
  sceneEntitiesManager,
} from 'lib/singletons'
import { CallExpression, SourceRange, Value, parse, recast } from 'lang/wasm'
import { ModelingMachineEvent } from 'machines/modelingMachine'
import { uuidv4 } from 'lib/utils'
import { EditorSelection } from '@codemirror/state'
import { SelectionRange } from '@uiw/react-codemirror'
import { getNormalisedCoordinates, isOverlap } from 'lib/utils'
import { isCursorInSketchCommandRange } from 'lang/util'
import { Program } from 'lang/wasm'
import {
  doesPipeHaveCallExp,
  getNodeFromPath,
  isSingleCursorInPipe,
} from 'lang/queryAst'
import { CommandArgument } from './commandTypes'
import {
  STRAIGHT_SEGMENT,
  TANGENTIAL_ARC_TO_SEGMENT,
  getParentGroup,
  PROFILE_START,
} from 'clientSideScene/sceneEntities'
import { Mesh, Object3D, Object3DEventMap } from 'three'
import { AXIS_GROUP, X_AXIS } from 'clientSideScene/sceneInfra'
import { PathToNodeMap } from 'lang/std/sketchcombos'
import { err } from 'lib/trap'

export const X_AXIS_UUID = 'ad792545-7fd3-482a-a602-a93924e3055b'
export const Y_AXIS_UUID = '680fd157-266f-4b8a-984f-cdf46b8bdf01'

export type Axis = 'y-axis' | 'x-axis' | 'z-axis'

export type Selection = {
  type:
    | 'default'
    | 'line-end'
    | 'line-mid'
    | 'extrude-wall'
    | 'start-cap'
    | 'end-cap'
    | 'point'
    | 'edge'
    | 'line'
    | 'arc'
    | 'all'
  range: SourceRange
}
export type Selections = {
  otherSelections: Axis[]
  codeBasedSelections: Selection[]
}

export async function getEventForSelectWithPoint(
  {
    data,
  }: Extract<
    Models['OkModelingCmdResponse_type'],
    { type: 'select_with_point' }
  >,
  { sketchEnginePathId }: { sketchEnginePathId?: string }
): Promise<ModelingMachineEvent | null> {
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
  let _artifact = engineCommandManager.artifactMap[data.entity_id]
  if (!_artifact) {
    // This logic for getting the parent id is for solid2ds as in edit mode it return the face id
    // but we don't recognise that in the artifact map because we store the path id when the path is
    // created, the solid2d is implicitly created with the close stdlib function
    // there's plans to get the faceId back from the solid2d creation
    // https://github.com/KittyCAD/engine/issues/2094
    // at which point we can add it to the artifact map and remove this logic
    const parentId = (
      await engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'entity_get_parent_id',
          entity_id: data.entity_id,
        },
        cmd_id: uuidv4(),
      })
    )?.data?.data?.entity_id
    const parentArtifact = engineCommandManager.artifactMap[parentId]
    if (parentArtifact) {
      _artifact = parentArtifact
    }
  }
  const sourceRange = _artifact?.range
  if (_artifact) {
    if (_artifact.commandType === 'solid3d_get_extrusion_face_info') {
      if (_artifact?.additionalData)
        return {
          type: 'Set selection',
          data: {
            selectionType: 'singleCodeCursor',
            selection: {
              range: sourceRange,
              type:
                _artifact?.additionalData.info === 'end'
                  ? 'end-cap'
                  : 'start-cap',
            },
          },
        }
      return {
        type: 'Set selection',
        data: {
          selectionType: 'singleCodeCursor',
          selection: { range: sourceRange, type: 'extrude-wall' },
        },
      }
    }
    return {
      type: 'Set selection',
      data: {
        selectionType: 'singleCodeCursor',
        selection: { range: sourceRange, type: 'default' },
      },
    }
  } else {
    // if we don't recognise the entity, select nothing
    return {
      type: 'Set selection',
      data: { selectionType: 'singleCodeCursor' },
    }
  }
}

export function getEventForSegmentSelection(
  obj: Object3D<Object3DEventMap>
): ModelingMachineEvent | null {
  const group = getParentGroup(obj, [
    STRAIGHT_SEGMENT,
    TANGENTIAL_ARC_TO_SEGMENT,
    PROFILE_START,
  ])
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

  const nodeMeta = getNodeFromPath<CallExpression>(
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
  const updated = parse(recast(kclManager.ast))
  if (err(updated)) return

  Object.values(sceneEntitiesManager.activeSegments).forEach((segmentGroup) => {
    if (
      ![STRAIGHT_SEGMENT, TANGENTIAL_ARC_TO_SEGMENT, PROFILE_START].includes(
        segmentGroup?.name
      )
    )
      return
    const nodeMeta = getNodeFromPath<CallExpression>(
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
    engineCommandManager.artifactMap,
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
  return doesPipeHaveCallExp({
    calleeName: 'extrude',
    ...node,
  })
}

function nodeHasClose(node: CommonASTNode) {
  return doesPipeHaveCallExp({
    calleeName: 'close',
    ...node,
  })
}

export function canExtrudeSelection(selection: Selections) {
  const commonNodes = selection.codeBasedSelections.map((_, i) =>
    buildCommonNodeFromSelection(selection, i)
  )
  return (
    !!isSketchPipe(selection) &&
    commonNodes.every((n) => nodeHasClose(n)) &&
    commonNodes.every((n) => !nodeHasExtrude(n))
  )
}

function canExtrudeSelectionItem(selection: Selections, i: number) {
  const commonNode = buildCommonNodeFromSelection(selection, i)

  return (
    !!isSketchPipe(selection) &&
    nodeHasClose(commonNode) &&
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
  selection: Selections
): ResolvedSelectionType[] {
  return selection.codeBasedSelections
    .map((s, i) => {
      if (canExtrudeSelectionItem(selection, i)) {
        return ['extrude-wall', 1] as ResolvedSelectionType // This is implicitly determining what a face is, which is bad
      } else {
        return ['other', 1] as ResolvedSelectionType
      }
    })
    .reduce((acc, [type, count]) => {
      const foundIndex = acc.findIndex((item) => item && item[0] === type)

      if (foundIndex === -1) {
        return [...acc, [type, count]]
      } else {
        const temp = [...acc]
        temp[foundIndex][1] += count
        return temp
      }
    }, [] as ResolvedSelectionType[])
}

export function getSelectionTypeDisplayText(
  selection: Selections
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
    .flatMap(({ type, range, ...rest }): null | SelectionToEngine[] => {
      // TODO #868: loops over all artifacts will become inefficient at a large scale
      const entriesWithOverlap = Object.entries(
        engineCommandManager.artifactMap || {}
      )
        .map(([id, artifact]) => {
          return artifact.range && isOverlap(artifact.range, range)
            ? {
                artifact,
                selection: { type, range, ...rest },
                id,
              }
            : false
        })
        .filter(Boolean)
      let bestCandidate
      entriesWithOverlap.forEach((entry) => {
        if (!entry) return
        if (
          type === 'default' &&
          entry.artifact.commandType === 'extend_path'
        ) {
          bestCandidate = entry
          return
        }
        if (
          type === 'start-cap' &&
          entry.artifact.commandType === 'solid3d_get_extrusion_face_info' &&
          entry?.artifact?.additionalData?.info === 'start'
        ) {
          bestCandidate = entry
          return
        }
        if (
          type === 'end-cap' &&
          entry.artifact.commandType === 'solid3d_get_extrusion_face_info' &&
          entry?.artifact?.additionalData?.info === 'end'
        ) {
          bestCandidate = entry
          return
        }
        if (
          type === 'extrude-wall' &&
          entry.artifact.commandType === 'solid3d_get_extrusion_face_info'
        ) {
          bestCandidate = entry
          return
        }
      })

      if (bestCandidate) {
        const _bestCandidate = bestCandidate as {
          artifact: any
          selection: any
          id: string
        }
        return [
          {
            type,
            id: _bestCandidate.id,
          },
        ]
      }
      return null
    })
    .filter(Boolean) as any
}

export async function sendSelectEventToEngine(
  e: MouseEvent | React.MouseEvent<HTMLDivElement, MouseEvent>,
  el: HTMLVideoElement,
  streamDimensions: { streamWidth: number; streamHeight: number }
) {
  const { x, y } = getNormalisedCoordinates({
    clientX: e.clientX,
    clientY: e.clientY,
    el,
    ...streamDimensions,
  })
  const result: Models['SelectWithPoint_type'] = await engineCommandManager
    .sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'select_with_point',
        selected_at_window: { x, y },
        selection_type: 'add',
      },
      cmd_id: uuidv4(),
    })
    .then((res) => res.data.data)
  return result
}

export function updateSelections(
  pathToNodeMap: PathToNodeMap,
  prevSelectionRanges: Selections,
  ast: Program | Error
): Selections | Error {
  if (ast instanceof Error) return ast

  return {
    ...prevSelectionRanges,
    codeBasedSelections: Object.entries(pathToNodeMap)
      .map(([index, pathToNode]): Selection | undefined => {
        const nodeMeta = getNodeFromPath<Value>(ast, pathToNode)
        if (err(nodeMeta)) return undefined
        const node = nodeMeta.node
        return {
          range: [node.start, node.end],
          type: prevSelectionRanges.codeBasedSelections[Number(index)]?.type,
        }
      })
      .filter((x?: Selection) => x !== undefined) as Selection[],
  }
}
