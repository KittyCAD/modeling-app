import { Models } from '@kittycad/lib'
import { engineCommandManager } from 'lang/std/engineConnection'
import { SourceRange } from 'lang/wasm'
import { ModelingEvent } from 'machines/modelingMachine'
import { v4 as uuidv4 } from 'uuid'
import { EditorView } from 'editor/highlightextension'
import { EditorSelection } from '@codemirror/state'
import { kclManager } from 'lang/KclSinglton'

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
  { sketchEnginePathId }: { sketchEnginePathId: string }
): Promise<ModelingEvent> {
  if (!data?.entity_id) {
    return {
      type: 'Set selection',
      data: { selectionType: 'singleCodeCursor' },
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

export function dispatchCodeMirrorCursor({
  selections,
  editorView,
}: {
  selections: Selections
  editorView: EditorView
}): {
  selectionRangeTypeMap: SelectionRangeTypeMap
} {
  const ranges: ReturnType<typeof EditorSelection.cursor>[] = []
  const selectionRangeTypeMap: SelectionRangeTypeMap = {}
  selections.codeBasedSelections.forEach(({ range, type }) => {
    if (range?.[1]) {
      ranges.push(EditorSelection.cursor(range[1]))
      selectionRangeTypeMap[range[1]] = type
    }
  })
  setTimeout(() => {
    ranges.length &&
      editorView.dispatch({
        selection: EditorSelection.create(
          ranges,
          selections.codeBasedSelections.length - 1
        ),
      })
  })
  return {
    selectionRangeTypeMap,
  }
}

export function setCodeMirrorCursor({
  codeSelection,
  currestSelections,
  editorView,
  isShiftDown,
}: {
  codeSelection?: Selection
  currestSelections: Selections
  editorView: EditorView
  isShiftDown: boolean
}): SelectionRangeTypeMap {
  // This DOES NOT set the `selectionRanges` in xstate context
  // instead it updates/dispatches to the editor, which in turn updates the xstate context
  // I've found this the best way to deal with the editor without causing an infinite loop
  // and really we want the editor to be in charge of cursor positions and for `selectionRanges` mirror it
  // because we want to respect the user manually placing the cursor too.
  const code = kclManager.code
  if (!codeSelection) {
    const { selectionRangeTypeMap } = dispatchCodeMirrorCursor({
      editorView,
      selections: {
        otherSelections: currestSelections.otherSelections,
        codeBasedSelections: [
          {
            range: [0, code.length ? code.length - 1 : 0],
            type: 'default',
          },
        ],
      },
    })
    return selectionRangeTypeMap
  }
  const selections: Selections = {
    ...currestSelections,
    codeBasedSelections: isShiftDown
      ? [...currestSelections.codeBasedSelections, codeSelection]
      : [codeSelection],
  }
  const { selectionRangeTypeMap } = dispatchCodeMirrorCursor({
    editorView,
    selections,
  })
  return selectionRangeTypeMap
}
