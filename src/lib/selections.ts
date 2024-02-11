import { Models } from '@kittycad/lib'
import { engineCommandManager } from 'lang/std/engineConnection'
import { CallExpression, SourceRange, parse, recast } from 'lang/wasm'
import { ModelingMachineEvent } from 'machines/modelingMachine'
import { v4 as uuidv4 } from 'uuid'
import { EditorSelection } from '@codemirror/state'
import { kclManager } from 'lang/KclSingleton'
import { SelectionRange } from '@uiw/react-codemirror'
import { isOverlap } from 'lib/utils'
import { isCursorInSketchCommandRange } from 'lang/util'
import { Program } from 'lang/wasm'
import { doesPipeHaveCallExp, getNodeFromPath } from 'lang/queryAst'
import { CommandArgument } from './commandTypes'
import {
  STRAIGHT_SEGMENT,
  TANGENTIAL_ARC_TO_SEGMENT,
  clientSideScene,
  getParentGroup,
} from 'clientSideScene/clientSideScene'
import { Mesh } from 'three'
import { AXIS_GROUP, X_AXIS } from 'clientSideScene/setup'

export const X_AXIS_UUID = 'ad792545-7fd3-482a-a602-a93924e3055b'
export const Y_AXIS_UUID = '680fd157-266f-4b8a-984f-cdf46b8bdf01'

/*
How selections work is complex due to the nature that we rely on the engine
to tell what has been selected after we send a click command. But than the
app needs these selections to be based on cursors, therefore the app must
be in control of selections. On top of that because we need to set cursor
positions in code-mirror for selections, both from app logic, and still
allow the user to add multiple cursors like a normal editor, it's best to
let code mirror control cursor positions and associate those source ranges
with entity ids from code-mirror events later.

So it's a lot of back and forth. conceptually the back and forth is:

1) we send a click command to the engine
2) the engine sends back ids of entities that were clicked
3) we associate that source ranges with those ids
4) we set the codemirror selection based on those source ranges (taking
  into account if the user is holding shift to add to current selections
  or not). we also create and remember a SelectionRangeTypeMap
5) Code mirror fires a an event that cursors have changed, we loop through
  these ranges and associate them with entity ids again with the ArtifactMap,
  but also we can pick up selection types using the SelectionRangeTypeMap
6) we clear all previous selections in the engine and set the new ones

The above is less likely to get stale but below is some more details,
because this wonders all over the code-base, I've tried to centeralise it
by putting relevant utils in this file. All of the functions below are
pure with the exception of getEventForSelectWithPoint which makes a call
to the engine, but it's a query call (not mutation) so I'm okay with this.
Actual side effects that change cursors or tell the engine what's selected
are still done throughout the in their relevant parts in the codebase.

In detail:

1) Click commands are mostly sent in stream.tsx search for
  "select_with_point"
2) The handler for when the engine sends back entity ids calls
  getEventForSelectWithPoint, it fires an XState event to update our
  selections is xstate context
3 and 4) The XState handler for the above uses handleSelectionBatch and
  handleSelectionWithShift to update the selections in xstate context as
  well as returning our SelectionRangeTypeMap and a codeMirror specific
  event to be dispatched.
5) The codeMirror handler for changes to the cursor uses
  processCodeMirrorRanges to associate the ranges back with their original
  types and the entity ids (the id can vary depending on the type, as
  there's only one source range for a given segment, but depending on if
  the user selected the segment directly or the vertex, the id will be
  different)
6) We take all of the ids and create events for the engine with
  resetAndSetEngineEntitySelectionCmds

An important note is that if a user changes the cursor directly themselves
then they skip directly to step 5, And these selections get a type of
"default".

There are a few more nuances than this, but best to find them in the code.
*/

export type Axis = 'y-axis' | 'x-axis' | 'z-axis'

export type Selection = {
  type:
    | 'default'
    | 'line-end'
    | 'line-mid'
    | 'face'
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

export interface SelectionRangeTypeMap {
  [key: number]: Selection['type']
}

interface RangeAndId {
  id: string
  range: SourceRange
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
  const sourceRange = engineCommandManager.artifactMap[data.entity_id]?.range
  if (engineCommandManager.artifactMap[data.entity_id]) {
    return {
      type: 'Set selection',
      data: {
        selectionType: 'singleCodeCursor',
        selection: { range: sourceRange, type: 'default' },
      },
    }
  }
  if (!sketchEnginePathId) return null
  // selected a vertex
  const res = await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'path_get_curve_uuids_for_vertices',
      vertex_ids: [data.entity_id],
      path_id: sketchEnginePathId,
    },
  })
  const curveIds = res?.data?.data?.curve_ids
  const ranges: RangeAndId[] = curveIds
    .map(
      (id: string): RangeAndId => ({
        id,
        range: engineCommandManager.artifactMap[id].range,
      })
    )
    .sort((a: RangeAndId, b: RangeAndId) => a.range[0] - b.range[0])
  // default to the head of the curve selected
  const _sourceRange = ranges?.[0].range
  const artifact = engineCommandManager.artifactMap[ranges?.[0]?.id]
  if (artifact.type === 'result') {
    artifact.headVertexId = data.entity_id
  }
  return {
    type: 'Set selection',
    data: {
      selectionType: 'singleCodeCursor',
      // line-end is used to indicate that headVertexId should be sent to the engine as "selected"
      // not the whole curve
      selection: { range: _sourceRange, type: 'line-end' },
    },
  }
}

export function getEventForSegmentSelection(
  obj: any
): ModelingMachineEvent | null {
  const group = getParentGroup(obj)
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
  const updatedAst = parse(kclManager.code)
  const node = getNodeFromPath<CallExpression>(
    updatedAst,
    pathToNode,
    'CallExpression'
  ).node
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
  selectionRangeTypeMap: SelectionRangeTypeMap
  codeMirrorSelection?: EditorSelection
  otherSelections: Axis[]
} {
  const ranges: ReturnType<typeof EditorSelection.cursor>[] = []
  const selectionRangeTypeMap: SelectionRangeTypeMap = {}
  selections.codeBasedSelections.forEach(({ range, type }) => {
    if (range?.[1]) {
      ranges.push(EditorSelection.cursor(range[1]))
      selectionRangeTypeMap[range[1]] = type
    }
  })
  if (ranges.length)
    return {
      selectionRangeTypeMap,
      codeMirrorSelection: EditorSelection.create(
        ranges,
        selections.codeBasedSelections.length - 1
      ),
      otherSelections: selections.otherSelections,
    }

  return {
    selectionRangeTypeMap,
    otherSelections: selections.otherSelections,
  }
}

export function handleSelectionWithShift({
  codeSelection,
  otherSelection,
  currentSelections,
  isShiftDown,
}: {
  codeSelection?: Selection
  otherSelection?: Axis
  currentSelections: Selections
  isShiftDown: boolean
}): {
  selectionRangeTypeMap: SelectionRangeTypeMap
  otherSelections: Axis[]
  codeMirrorSelection?: EditorSelection
} {
  const code = kclManager.code
  if (codeSelection && otherSelection) {
    throw new Error('cannot have both code and other selection')
  }
  if (!codeSelection && !otherSelection) {
    return handleSelectionBatch({
      selections: {
        otherSelections: [],
        codeBasedSelections: [
          {
            range: [0, code.length ? code.length : 0],
            type: 'default',
          },
        ],
      },
    })
  }
  if (otherSelection) {
    return handleSelectionBatch({
      selections: {
        codeBasedSelections: isShiftDown
          ? currentSelections.codeBasedSelections
          : [
              {
                range: [0, code.length ? code.length : 0],
                type: 'default',
              },
            ],
        otherSelections: [otherSelection],
      },
    })
  }
  const isEndOfFileDumbySelection =
    currentSelections.codeBasedSelections.length === 1 &&
    currentSelections.codeBasedSelections[0].range[0] === kclManager.code.length
  const newCodeBasedSelections = !isShiftDown
    ? [codeSelection!]
    : isEndOfFileDumbySelection
    ? [codeSelection!]
    : [...currentSelections.codeBasedSelections, codeSelection!]
  const selections: Selections = {
    otherSelections: isShiftDown ? currentSelections.otherSelections : [],
    codeBasedSelections: newCodeBasedSelections,
  }
  return handleSelectionBatch({ selections })
}

type SelectionToEngine = { type: Selection['type']; id: string }

export function processCodeMirrorRanges({
  codeMirrorRanges,
  selectionRanges,
  selectionRangeTypeMap,
  isShiftDown,
}: {
  codeMirrorRanges: readonly SelectionRange[]
  selectionRanges: Selections
  selectionRangeTypeMap: SelectionRangeTypeMap
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
      if (selectionRangeTypeMap[to]) {
        return {
          type: selectionRangeTypeMap[to],
          range: [from, to],
        }
      }
      return {
        type: 'default',
        range: [from, to],
      }
    })
  const idBasedSelections: SelectionToEngine[] = codeBasedSelections
    .flatMap(({ type, range }): null | SelectionToEngine[] => {
      // TODO #868: loops over all artifacts will become inefficient at a large scale
      const entriesWithOverlap = Object.entries(
        engineCommandManager.artifactMap || {}
      ).filter(([_, artifact]) => {
        return artifact.range && isOverlap(artifact.range, range)
          ? artifact
          : false
      })
      if (entriesWithOverlap.length) {
        return entriesWithOverlap.map(([id, artifact]) => ({
          type,
          id:
            type === 'line-end' &&
            artifact.type === 'result' &&
            artifact.headVertexId
              ? artifact.headVertexId
              : id,
        }))
      }
      return null
    })
    .filter(Boolean) as any

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
  let updated: Program
  try {
    updated = parse(recast(kclManager.ast))
  } catch (e) {
    console.error('error parsing code in processCodeMirrorRanges', e)
    return
  }
  Object.values(clientSideScene.activeSegments).forEach((segmentGroup) => {
    if (
      ![STRAIGHT_SEGMENT, TANGENTIAL_ARC_TO_SEGMENT].includes(
        segmentGroup?.userData?.type
      )
    )
      return
    const node = getNodeFromPath<CallExpression>(
      updated,
      segmentGroup.userData.pathToNode,
      'CallExpression'
    ).node
    const groupHasCursor = codeBasedSelections.some((selection) => {
      return isOverlap(selection.range, [node.start, node.end])
    })
    const color = groupHasCursor ? 0x0000ff : 0xffffff
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
    console.log('engine connection is not ready')
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

export function buildCommonNodeFromSelection(
  selectionRanges: Selections,
  i: number
) {
  return {
    selection: selectionRanges.codeBasedSelections[i],
    ast: kclManager.ast,
  }
}

export function nodeHasExtrude(node: CommonASTNode) {
  return doesPipeHaveCallExp({
    calleeName: 'extrude',
    ...node,
  })
}

export function nodeHasClose(node: CommonASTNode) {
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

export function canExtrudeSelectionItem(selection: Selections, i: number) {
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
        return ['face', 1] as ResolvedSelectionType // This is implicitly determining what a face is, which is bad
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
    .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
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
