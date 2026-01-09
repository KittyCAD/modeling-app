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
  filterOperations,
} from '@src/lib/operations'
import type { ArtifactGraph, SourceRange } from '@src/lang/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { reportRejection } from '@src/lib/trap'

async function clearSceneSelection() {
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd: {
      type: 'select_clear',
    },
    cmd_id: uuidv4(),
  })
}

// Pass in a list of scene ids to select in the 3d scene
async function sceneSelection(ids: string[]) {
  await engineCommandManager.sendSceneCommand({
    cmd_id: uuidv4(),
    type: 'modeling_cmd_req',
    cmd: {
      type: 'select_add',
      entities: ids,
    },
  })
}

function formatArtifactGraph(
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
) {
  const idsWithTypes = Array.from(artifactGraph).map(([key, artifact]) => {
    const type = artifact.type
    const id = artifact.id
    let codeRefToIds: string[] = []
    let sourceRanges: SourceRange[] = []
    let range: SourceRange | null = null
    let featureTreeFromSourceRange: ReturnType<typeof computeOperationList> = []
    if ('codeRef' in artifact) {
      const codeRef = artifact.codeRef
      range = codeRef.range
      codeRefToIds = codeRangeToIds(codeRef.range, wasmInstance)
      sourceRanges = idToCodeRange(id) || []
      const result = computeOperationList(generateOperationList(), wasmInstance)
      const featureTrees = result.filter((feature) => {
        if ('sourceRange' in feature) {
          return (
            codeRef?.range[0] === feature.sourceRange[0] &&
            codeRef?.range[1] === feature.sourceRange[1] &&
            codeRef?.range[2] === feature.sourceRange[2]
          )
        } else {
          return false
        }
      })
      featureTreeFromSourceRange = featureTrees
    }
    return {
      id,
      type,
      range,
      codeRefToIds,
      sourceRanges,
      featureTreeFromSourceRange,
    }
  })
  return idsWithTypes
}

async function selectionFromId(id: string) {
  await clearSceneSelection()
  await sceneSelection([id])
}

async function selectCodeMirrorRange(range: SourceRange) {
  if (!range) return
  await clearSceneSelection()
  const selections: Selections = {
    graphSelections: [
      {
        // @ts-ignore This is a debugging tool, I do not have the pathToNode
        codeRef: {
          range,
        },
      },
    ],
    otherSelections: [],
  }
  kclManager.selectRange(selections)
}

function codeRangeToIds(
  range: SourceRange,
  wasmInstance: ModuleType
): string[] {
  if (!range) return []

  const selections = {
    graphSelections: [
      {
        artifact: {},
        codeRef: {
          range: range,
        },
      },
    ],
    otherSelections: [],
  }

  const editorView = kclManager.getEditorView()
  if (!editorView) return []

  // We have to mock as if the user was selecting these instead of reading from the
  // actual code mirror instance
  const asIfItWasSelected = EditorSelection.create([
    EditorSelection.range(
      selections.graphSelections[0].codeRef.range[0],
      selections.graphSelections[0].codeRef.range[1]
    ),
  ])
  const eventInfo = processCodeMirrorRanges({
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
  const arrayOfEntityIds = getEntityIdsFromCmds(eventInfo)
  return arrayOfEntityIds
}

function getEntityIdsFromCmds(
  eventInfo: ReturnType<typeof processCodeMirrorRanges>
): string[] {
  if (!eventInfo || !eventInfo.engineEvents) {
    return []
  }
  const engineEvents = eventInfo.engineEvents
  // A list of engine command is produced, filter out the select_add ones
  // which contain the entity ids
  const selectAdds = engineEvents.filter((event) => {
    if ('cmd' in event && 'type' in event.cmd) {
      return event.cmd.type === 'select_add'
    }
    return false
  })
  let ids: string[] = []
  selectAdds.forEach((event) => {
    if ('cmd' in event && 'type' in event.cmd && 'entities' in event.cmd) {
      const entities = event.cmd.entities
      ids = ids.concat(entities)
    }
  })
  return ids
}

function idToCodeRange(id: string) {
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

// Ported from the feature tree codebase
function generateOperationList() {
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

  // We filter out operations that are not useful to show in the feature tree
  const operationList =
    groupOperationTypeStreaks(filterOperations(unfilteredOperationList), [
      'VariableDeclaration',
    ]) || []

  return operationList.flat()
}

// A helper function that will append more data from reading the operation list
// This will be used for rendering in the DOM
function computeOperationList(
  operationList: Operation[],
  wasmInstance: ModuleType
) {
  const idsWithTypes = operationList.map((operation) => {
    let codeRefToIds: string[] = []
    if ('sourceRange' in operation) {
      const sourceRange: SourceRange = operation.sourceRange
      codeRefToIds = codeRangeToIds(sourceRange, wasmInstance)
    }
    return { codeRefToIds, ...operation }
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
  const highlightMinor = 'bg-red-200 dark:bg-red-950'
  const highlightMajor = 'bg-red-100 dark:bg-red-800'
  const artifactGraphTree = useMemo(() => {
    return formatArtifactGraph(kclManager.artifactGraph, wasmInstance)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [kclManager.artifactGraph])

  const operationList = useMemo(() => {
    return computeOperationList(generateOperationList(), wasmInstance)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [kclManager.artifactGraph])
  return (
    <details data-testid="debug-selections" className="relative">
      <summary>Selections Debugger</summary>
      <div>
        {artifactGraphTree.map((artifact) => {
          const highlightMyId = artifact.id === selectedId
          const highlightMyRange = artifact?.range?.join(',') === selectedRange
          return (
            <div className="text-xs flex flex-col justify-between">
              <div className="text-xs hover:bg-cyan-600 hover:text-white flex flex-row justify-between bg-chalkboard-40 dark:bg-chalkboard-80">
                <div
                  className={`cursor-pointer ${highlightMyId ? highlightMajor : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    selectionFromId(artifact.id).catch(reportRejection)
                    setSelectedId(artifact.id)
                  }}
                >
                  {artifact.id}
                </div>
                <div>{artifact.type}</div>
                <div
                  className={`cursor-pointer ${highlightMyRange ? highlightMajor : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (artifact.range) {
                      selectCodeMirrorRange(artifact.range).catch(
                        reportRejection
                      )
                      const rangeString = artifact.range.join(',')
                      setSelectedRange(rangeString)
                    }
                  }}
                >
                  {`[${artifact.range}]` || ''}
                </div>
              </div>
              <div className="text-xs flex flex-col justify-between">
                <div className="ml-2">Range(s) from id</div>
                {artifact.sourceRanges.map((range) => {
                  const highlightMyRange = range.join(',') === selectedRange
                  return (
                    <div
                      className={`ml-4 cursor-pointer ${highlightMyRange ? highlightMinor : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        const codeRef = {
                          range: range,
                        }
                        selectCodeMirrorRange(range).catch(reportRejection)
                        const rangeString = codeRef.range.join(',')
                        setSelectedRange(rangeString)
                      }}
                    >
                      {`[${range}]` || ''}
                    </div>
                  )
                })}
              </div>
              <div className="text-xs flex flex-col justify-between">
                <div
                  className={`ml-2 cursor-pointer ${highlightMyRange ? highlightMinor : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (artifact.range) {
                      selectCodeMirrorRange(artifact.range).catch(
                        reportRejection
                      )
                      const rangeString = artifact.range.join(',')
                      setSelectedRange(rangeString)
                    }
                  }}
                >
                  {`[${artifact.range}] range to id(s)` || ''}
                </div>
                {artifact.codeRefToIds.map((id) => {
                  const highlightMyId = id === selectedId
                  return (
                    <div
                      className={`ml-4 cursor-pointer ${highlightMyId ? highlightMinor : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        selectionFromId(id).catch(reportRejection)
                        setSelectedId(id)
                      }}
                    >
                      {id}
                    </div>
                  )
                })}
              </div>
              <div className="ml-2 text-xs">Range to Feature Tree item(s)</div>
              <div className="ml-4 text-xs flex flex-col justify-between">
                {artifact.featureTreeFromSourceRange.map((operation) => {
                  let highlightMyRange = false
                  let range: SourceRange = defaultSourceRange()
                  let name: string = '[name not found]'
                  if ('sourceRange' in operation) {
                    highlightMyRange =
                      operation.sourceRange.join(',') === selectedRange
                    range = operation.sourceRange
                  }
                  if ('name' in operation) {
                    name = operation.name
                  }
                  return (
                    <div className="text-xs flex flex-col justify-between">
                      <div className="flex flex-row justify-between">
                        <div>{name}</div>
                        <div>{operation.type}</div>
                        <div
                          className={`ml-2 cursor-pointer ${highlightMyRange ? highlightMinor : ''}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            selectCodeMirrorRange(range).catch(reportRejection)
                            const rangeString = range.join(',')
                            setSelectedRange(rangeString)
                          }}
                        >
                          {`[${range}]` || ''}
                        </div>
                      </div>
                      {operation?.codeRefToIds?.map((id) => {
                        const highlightMyId = id === selectedId
                        return (
                          <div
                            className={`ml-4 cursor-pointer ${highlightMyId ? highlightMinor : ''}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              selectionFromId(id).catch(reportRejection)
                              setSelectedId(id)
                            }}
                          >
                            {id}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        <div>Feature Tree</div>
        {operationList.map((operation) => {
          let highlightMyRange = false
          let range: SourceRange = defaultSourceRange()
          let name: string = '[name not found]'
          if ('sourceRange' in operation) {
            highlightMyRange =
              operation?.sourceRange?.join(',') === selectedRange
            range = operation.sourceRange
          }
          if ('name' in operation) {
            name = operation.name
          }
          return (
            <div className="text-xs flex flex-col justify-between">
              <div className="flex flex-row justify-between">
                <div>{name}</div>
                <div>{operation.type}</div>
                <div
                  className={`ml-2 cursor-pointer ${highlightMyRange ? highlightMinor : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    selectCodeMirrorRange(range).catch(reportRejection)
                    const rangeString = range.join(',')
                    setSelectedRange(rangeString)
                  }}
                >
                  {`[${range}]` || ''}
                </div>
              </div>
              {operation.codeRefToIds.map((id) => {
                const highlightMyId = id === selectedId
                return (
                  <div
                    className={`ml-4 cursor-pointer ${highlightMyId ? highlightMinor : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      selectionFromId(id).catch(reportRejection)
                      setSelectedId(id)
                    }}
                  >
                    {id}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </details>
  )
}
