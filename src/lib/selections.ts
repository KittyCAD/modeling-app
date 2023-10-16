import { Models } from '@kittycad/lib'
import { engineCommandManager } from 'lang/std/engineConnection'
import { SourceRange } from 'lang/wasm'
import { ModelingEvent } from 'machines/modelingMachine'
import { v4 as uuidv4 } from 'uuid'
import { EditorSelection } from '@codemirror/state'
import { kclManager } from 'lang/KclSinglton'
import { SelectionRange } from '@uiw/react-codemirror'
import { isOverlap } from 'lib/utils'

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

export function handleSelectionBatch({
  selections,
}: {
  selections: Selections
}): {
  selectionRangeTypeMap: SelectionRangeTypeMap
  codeMirrorSelection?: EditorSelection
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
    }

  return {
    selectionRangeTypeMap,
  }
}

export function handleSelectionWithShift({
  codeSelection,
  currestSelections,
  isShiftDown,
}: {
  codeSelection?: Selection
  currestSelections: Selections
  isShiftDown: boolean
}): {
  selectionRangeTypeMap: SelectionRangeTypeMap
  codeMirrorSelection?: EditorSelection
} {
  // This DOES NOT set the `selectionRanges` in xstate context
  // instead it updates/dispatches to the editor, which in turn updates the xstate context
  // I've found this the best way to deal with the editor without causing an infinite loop
  // and really we want the editor to be in charge of cursor positions and for `selectionRanges` mirror it
  // because we want to respect the user manually placing the cursor too.
  const code = kclManager.code
  if (!codeSelection)
    return handleSelectionBatch({
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
  const selections: Selections = {
    ...currestSelections,
    codeBasedSelections: isShiftDown
      ? [...currestSelections.codeBasedSelections, codeSelection]
      : [codeSelection],
  }
  return handleSelectionBatch({ selections })
}

type SelectionToEngine = { type: Selection['type']; id: string }

export function processCodeMirrorRanges({
  codeMirrorRanges,
  selectionRanges,
  selectionRangeTypeMap,
}: {
  codeMirrorRanges: readonly SelectionRange[]
  selectionRanges: Selections
  selectionRangeTypeMap: SelectionRangeTypeMap
}): null | {
  modelingEvent: ModelingEvent
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
    .map(({ type, range }): null | SelectionToEngine => {
      // TODO #868: loops over all artifacts will become inefficient at a large scale
      const entriesWithOverlap = Object.entries(
        engineCommandManager.artifactMap || {}
      ).filter(([_, artifact]) => {
        return artifact.range && isOverlap(artifact.range, range)
          ? artifact
          : false
      })
      if (entriesWithOverlap.length) {
        const [id, artifact] = entriesWithOverlap?.[0]
        return {
          type,
          id:
            type === 'line-end' &&
            artifact.type === 'result' &&
            artifact.headVertexId
              ? artifact.headVertexId
              : id,
        }
      }
      return null
    })
    .filter(Boolean) as any

  if (!selectionRanges) return null
  return {
    modelingEvent: {
      type: 'Set selection',
      data: {
        selectionType: 'mirrorCodeMirrorSelections',
        selection: {
          ...selectionRanges,
          codeBasedSelections,
        },
      },
    },
    engineEvents: resetAndSetEngineEntitySelectionCmds(idBasedSelections),
  }
}

export function resetAndSetEngineEntitySelectionCmds(
  selections: SelectionToEngine[]
): Models['WebSocketRequest_type'][] {
  if (!engineCommandManager.engineConnection?.isReady()) {
    console.log('engine connection isnt ready')
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
