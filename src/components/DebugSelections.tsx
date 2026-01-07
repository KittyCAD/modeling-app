import {
  kclManager,
  engineCommandManager,
  sceneEntitiesManager,
} from '@src/lib/singletons'
import { useMemo, useState } from 'react'
import { uuidv4 } from '@src/lib/utils'
import { processCodeMirrorRanges } from '@src/lib/selections'
import { use } from 'react'
import { EditorSelection } from '@codemirror/state'
import { defaultSourceRange } from '@src/lang/sourceRange'
import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import {
  groupOperationTypeStreaks,
  filterOperations
} from '@src/lib/operations'

async function clearSelection() {
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd: {
      type: 'select_clear',
    },
    cmd_id: uuidv4(),
  })
}

async function makeSelections(ids) {
  await engineCommandManager.sendSceneCommand({
    cmd_id: uuidv4(),
    type: 'modeling_cmd_req',
    cmd: {
      type: 'select_add',
      entities: ids,
    },
  })
}

async function makeHighlights(ids) {
  await engineCommandManager.sendSceneCommand({
    cmd_id: uuidv4(),
    type: 'modeling_cmd_req',
    cmd: {
      type: 'highlight_set_entities',
      entities: ids,
    },
  })
}

function compute(artifactGraph, wasmInstance) {

  const operationList = generateOperationList()

  // name
  // source range
  const idsWithTypes = Array.from(artifactGraph).map((a) => {
    const key = a[0]
    const obj = a[1]

    const type = obj.type
    const id = obj.id
    const codeRef = obj.codeRef
    const codeRefToIds = codeRangeToEventInfo(codeRef, wasmInstance)
    const artifactIdtoCodeRefs = artifactToCodeRange(id) || []
    let featureTreeFromSourceRange = []
      // huh?
      const featureTrees = operationList.filter((feature) => {
        return codeRef?.range[0] === feature.sourceRange[0] && codeRef?.range[1] === feature.sourceRange[1] && codeRef?.range[2] === feature.sourceRange[2]

      })
      featureTreeFromSourceRange = featureTrees
    return { id, type, codeRef, codeRefToIds, artifactIdtoCodeRefs, featureTreeFromSourceRange }
  })
  return idsWithTypes
}

async function selectionFromId(id) {
  await clearSelection()
  await makeSelections([id])
}

async function selectionFromRange(codeRef) {
  if (!codeRef) {
    console.log('missing code ref')
    return
  }
  await clearSelection()
  const selections = {
    graphSelections: [
      {
        artifact: {},
        codeRef,
      },
    ],
    otherSelections: [],
  }
  kclManager.selectRange(selections)
}

function codeRangeToEventInfo(codeRef, wasmInstance) {
  if (!codeRef) {
    // no code refs
    return []
  }

  const selections = {
    graphSelections: [
      {
        artifact: {},
        codeRef,
      },
    ],
    otherSelections: [],
  }

  const editorView = kclManager.getEditorView()

  if (!editorView) {
    console.log('missing getEditorView()')
    return []
  }

  const asIfItWasSelected = EditorSelection.create([
    EditorSelection.range(
      selections.graphSelections[0].codeRef.range[0],
      selections.graphSelections[0].codeRef.range[1]
    ),
  ])
  const eventInfo = processCodeMirrorRanges({
    // codeMirrorRanges: editorView.state.selection.ranges,
    codeMirrorRanges: asIfItWasSelected.ranges,
    selectionRanges: {
      graphSelections: [],
      otherSelections: [],
    },
    isShiftDown: kclManager.isShiftDown,
    ast: kclManager.ast,
    artifactGraph: kclManager.artifactGraph,
    artifactIndex: kclManager.artifactIndex,
    systemDeps: {
      engineCommandManager: engineCommandManager,
      sceneEntitiesManager,
      wasmInstance: wasmInstance,
    },
  })
  const arrayOfEntityIds = parseOutAllSelectAddEntities(eventInfo)
  return arrayOfEntityIds
}

function parseOutAllSelectAddEntities(eventInfo) {
  if (!eventInfo || !eventInfo.engineEvents) {
    return []
  }
  const engineEvents = eventInfo.engineEvents
  const selectAdds = engineEvents.filter((event) => {
    return event.cmd.type === 'select_add'
  })
  let ids = []
  selectAdds.forEach((event) => {
    const entities = event.cmd.entities
    ids = ids.concat(entities)
  })
  return ids
}

function artifactToCodeRange(id) {
  if (id) {
    const codeRefs = getCodeRefsByArtifactId(id, kclManager.artifactGraph)
    if (codeRefs) {
      return codeRefs.map(({ range }) => range)
    }
  } else if (
    !kclManager.highlightRange ||
    (kclManager.highlightRange[0] &&
      kclManager.highlightRange[0][0] !== 0 &&
      kclManager.highlightRange[0][1] !== 0)
  ) {
    return [defaultSourceRange()]
  }
}

function generateOperationList () {
  // If there are parse errors we show the last successful operations
  // and overlay a message on top of the pane
  const parseErrors = kclManager.errors.filter((e) => e.kind !== 'engine')

  // If there are engine errors we show the successful operations
  // Errors return an operation list, so use the longest one if there are multiple
  const longestErrorOperationList = kclManager.errors.reduce((acc, error) => {
    return error.operations && error.operations.length > acc.length
      ? error.operations
      : acc
  }, [] as Operation[])

  const unfilteredOperationList = !parseErrors.length
    ? !kclManager.errors.length
      ? kclManager.execState.operations
      : longestErrorOperationList
    : kclManager.lastSuccessfulOperations
  // We use the code that corresponds to the operations. In case this is an
  // error on the first run, fall back to whatever is currently in the code
  // editor.
  const operationsCode =
    kclManager.lastSuccessfulCode || kclManager.codeSignal.value

  // We filter out operations that are not useful to show in the feature tree
  const operationList = groupOperationTypeStreaks(
    filterOperations(unfilteredOperationList),
    ['VariableDeclaration']
  ) || []

  return operationList.flat()
}

function computeOperationList (operationList, wasmInstance) {
  const idsWithTypes = operationList.map((operation) => {
    const codeRefToIds = codeRangeToEventInfo({
      range: operation.sourceRange,
      nodeToPath: operation.nodeToPath
    }, wasmInstance)
    return {codeRefToIds, ...operation}
  })
  return idsWithTypes

}

export function DebugSelections() {
  const [selectedId, _setSelectedId] = useState('')
  const [selectedRange, _setSelectedRange] = useState('')
  const setSelectedId = (id: string) => {
    _setSelectedId(id)
    _setSelectedRange('')
  }
  const setSelectedRange = (range: string) => {
    _setSelectedId('')
    _setSelectedRange(range)
  }
  const wasmInstance = use(kclManager.wasmInstancePromise)
  const highlightMinor = 'bg-red-950'
  const highlightMajor = 'bg-red-800'
  const artifactGraphTree = useMemo(() => {
    const result = compute(kclManager.artifactGraph, wasmInstance)
    return result

    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [kclManager.artifactGraph])

  const operationList = useMemo(() => {
    const result = computeOperationList(generateOperationList(), wasmInstance)
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [kclManager.artifactGraph])
  return (
    <div>
      {artifactGraphTree.map((a) => {
        const hightlightMyId = a.id === selectedId
        const highlightMyRange = a?.codeRef?.range?.join(',') === selectedRange
        return (
          <div className="text-xs flex flex-col justify-between">
            <div className="text-xs hover:bg-cyan-600 flex flex-row justify-between bg-chalkboard-80">
              <div
                className={`cursor-pointer ${hightlightMyId ? highlightMajor : ''}`}
                onClick={() => {
                  selectionFromId(a.id)
                  setSelectedId(a.id)
                }}
              >
                {a.id}
              </div>
              <div>{a.type}</div>
              <div
                className={`cursor-pointer ${highlightMyRange ? highlightMajor : ''}`}
                onClick={() => {
                  selectionFromRange(a.codeRef)
                  const rangeString = a.codeRef.range.join(',')
                  setSelectedRange(rangeString)
                }}
              >
                {`[${a.codeRef?.range}]` || ''}
              </div>
            </div>
            <div className="text-xs flex flex-col justify-between">
              <div className="ml-2">Ranges</div>
              {a.artifactIdtoCodeRefs.map((range) => {
                const highlightMyRange = range.join(',') === selectedRange
                return (
                  <div
                    className={`ml-4 cursor-pointer ${highlightMyRange ? highlightMinor : ''}`}
                    onClick={() => {}}
                  >
                    {`[${range}]` || ''}
                  </div>
                )
              })}
            </div>
            <div className="text-xs flex flex-col justify-between">
              <div
                className={`ml-2 cursor-pointer ${highlightMyRange ? highlightMinor : ''}`}
                onClick={() => {
                  selectionFromRange(a.codeRef)
                  const rangeString = a.codeRef.range.join(',')
                  setSelectedRange(rangeString)
                }}
              >
                {`[${a.codeRef?.range}]` || ''}
              </div>
              {a.codeRefToIds.map((id) => {
                const highlightMyId = id === selectedId
                return (
                  <div
                    className={`ml-4 cursor-pointer ${highlightMyId ? highlightMinor : ''}`}
                    onClick={() => {
                      selectionFromId(id)
                      setSelectedId(id)
                    }}
                  >
                    {id}
                  </div>
                )
              })}
            </div>
            <div className="ml-2 text-xs flex flex-col justify-between">
              Feature Tree mappings {a.featureTreeFromSourceRange.length}
            </div>
          </div>
        )
      })}
      <div>
        Feature Tree
      </div>
      {

        operationList.map((operation) => {
        const highlightMyRange = operation?.sourceRange?.join(',') === selectedRange
          const codeRef = {
            range: operation.sourceRange,
            nodeToPath: operation.nodeToPath
                    }
          return (
            <div className="text-xs flex flex-col justify-between odd:bg-chalkboard-90">
              <div className="flex flex-row justify-between">
                <div>
                  {operation.name || '<< NAME IS UNDEFINED >>'}
                </div>
                <div>
                  {operation.type}
                </div>
                <div
                  className={`ml-2 cursor-pointer ${highlightMyRange ? highlightMinor : ''}`}
                  onClick={() => {
                    selectionFromRange(codeRef)
                    const rangeString = codeRef.range.join(',')
                    setSelectedRange(rangeString)
                  }}
                >
                  {`[${codeRef?.range}]` || ''}
                </div>
              </div>
              {operation.codeRefToIds.map((id) => {
                const highlightMyId = id === selectedId
                return (
                  <div
                    className={`ml-4 cursor-pointer ${highlightMyId ? highlightMinor : ''}`}
                    onClick={() => {
                      selectionFromId(id)
                      setSelectedId(id)
                    }}
                  >
                    {id}
                  </div>
                )
              })}
            </div>
          )
        })
      }
    </div>
  )
}
