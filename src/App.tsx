import { useRef, useEffect, useMemo } from 'react'
import { Allotment } from 'allotment'
import { DebugPanel } from './components/DebugPanel'
import { asyncLexer } from './lang/tokeniser'
import { abstractSyntaxTree } from './lang/abstractSyntaxTree'
import { _executor, ExtrudeGroup, SketchGroup } from './lang/executor'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { ViewUpdate } from '@codemirror/view'
import {
  lineHighlightField,
  addLineHighlight,
} from './editor/highlightextension'
import { Selections, useStore } from './useStore'
import { Logs, KCLErrors } from './components/Logs'
import { PanelHeader } from './components/PanelHeader'
import { MemoryPanel } from './components/MemoryPanel'
import { useHotKeyListener } from './hooks/useHotKeyListener'
import { Stream } from './components/Stream'
import ModalContainer from 'react-modal-promise'
import { EngineCommandManager } from './lang/std/engineConnection'
import { isOverlap } from './lib/utils'
import { SetToken } from './components/TokenInput'
import { AppHeader } from './components/AppHeader'
import { KCLError } from './lang/errors'

export function App() {
  const cam = useRef()
  useHotKeyListener()
  const {
    editorView,
    setEditorView,
    setSelectionRanges,
    selectionRanges,
    addLog,
    addKCLError,
    code,
    setCode,
    setAst,
    setError,
    setProgramMemory,
    resetLogs,
    selectionRangeTypeMap,
    setArtifactMap,
    engineCommandManager: _engineCommandManager,
    setEngineCommandManager,
    setHighlightRange,
    setCursor2,
    sourceRangeMap,
    setMediaStream,
    setIsStreamReady,
    isStreamReady,
    token,
    formatCode,
    debugPanel,
  } = useStore((s) => ({
    editorView: s.editorView,
    setEditorView: s.setEditorView,
    setSelectionRanges: s.setSelectionRanges,
    selectionRanges: s.selectionRanges,
    setGuiMode: s.setGuiMode,
    addLog: s.addLog,
    code: s.code,
    setCode: s.setCode,
    setAst: s.setAst,
    setError: s.setError,
    setProgramMemory: s.setProgramMemory,
    resetLogs: s.resetLogs,
    selectionRangeTypeMap: s.selectionRangeTypeMap,
    setArtifactMap: s.setArtifactNSourceRangeMaps,
    engineCommandManager: s.engineCommandManager,
    setEngineCommandManager: s.setEngineCommandManager,
    setHighlightRange: s.setHighlightRange,
    isShiftDown: s.isShiftDown,
    setCursor: s.setCursor,
    setCursor2: s.setCursor2,
    sourceRangeMap: s.sourceRangeMap,
    setMediaStream: s.setMediaStream,
    isStreamReady: s.isStreamReady,
    setIsStreamReady: s.setIsStreamReady,
    token: s.token,
    formatCode: s.formatCode,
    debugPanel: s.debugPanel,
    addKCLError: s.addKCLError,
  }))
  // const onChange = React.useCallback((value: string, viewUpdate: ViewUpdate) => {
  const onChange = (value: string, viewUpdate: ViewUpdate) => {
    setCode(value)
    if (editorView) {
      editorView?.dispatch({ effects: addLineHighlight.of([0, 0]) })
    }
  } //, []);
  const onUpdate = (viewUpdate: ViewUpdate) => {
    if (!editorView) {
      setEditorView(viewUpdate.view)
    }
    const ranges = viewUpdate.state.selection.ranges

    const isChange =
      ranges.length !== selectionRanges.codeBasedSelections.length ||
      ranges.some(({ from, to }, i) => {
        return (
          from !== selectionRanges.codeBasedSelections[i].range[0] ||
          to !== selectionRanges.codeBasedSelections[i].range[1]
        )
      })

    if (!isChange) return
    const codeBasedSelections: Selections['codeBasedSelections'] = ranges.map(
      ({ from, to }) => {
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
      }
    )
    const idBasedSelections = codeBasedSelections
      .map(({ type, range }) => {
        const hasOverlap = Object.entries(sourceRangeMap).filter(
          ([_, sourceRange]) => {
            return isOverlap(sourceRange, range)
          }
        )
        if (hasOverlap.length) {
          return {
            type,
            id: hasOverlap[0][0],
          }
        }
      })
      .filter(Boolean) as any

    _engineCommandManager?.cusorsSelected({
      otherSelections: [],
      idBasedSelections,
    })

    setSelectionRanges({
      otherSelections: [],
      codeBasedSelections,
    })
  }
  const engineCommandManager = useMemo(() => {
    return new EngineCommandManager({
      setMediaStream,
      setIsStreamReady,
      token,
    })
  }, [token])
  useEffect(() => {
    return () => {
      engineCommandManager?.tearDown()
    }
  }, [engineCommandManager])

  useEffect(() => {
    if (!isStreamReady) return
    const asyncWrap = async () => {
      try {
        if (!code) {
          setAst(null)
          return
        }
        const tokens = await asyncLexer(code)
        const _ast = abstractSyntaxTree(tokens)
        setAst(_ast)
        resetLogs()
        if (_engineCommandManager) {
          _engineCommandManager.endSession()
        }
        engineCommandManager.startNewSession()
        setEngineCommandManager(engineCommandManager)
        _executor(
          _ast,
          {
            root: {
              log: {
                type: 'userVal',
                value: (a: any) => {
                  addLog(a)
                },
                __meta: [
                  {
                    pathToNode: [],
                    sourceRange: [0, 0],
                  },
                ],
              },
              _0: {
                type: 'userVal',
                value: 0,
                __meta: [],
              },
              _90: {
                type: 'userVal',
                value: 90,
                __meta: [],
              },
              _180: {
                type: 'userVal',
                value: 180,
                __meta: [],
              },
              _270: {
                type: 'userVal',
                value: 270,
                __meta: [],
              },
            },
            pendingMemory: {},
          },
          engineCommandManager,
          { bodyType: 'root' },
          []
        ).then(async (programMemory) => {
          const { artifactMap, sourceRangeMap } =
            await engineCommandManager.waitForAllCommands()

          setArtifactMap({ artifactMap, sourceRangeMap })
          engineCommandManager.onHover((id) => {
            if (!id) {
              setHighlightRange([0, 0])
            } else {
              const sourceRange = sourceRangeMap[id]
              setHighlightRange(sourceRange)
            }
          })
          engineCommandManager.onClick(({ id, type }) => {
            setCursor2({ range: sourceRangeMap[id], type })
          })
          setProgramMemory(programMemory)
          const geos = programMemory?.return
            ?.map(({ name }: { name: string }) => {
              const artifact = programMemory?.root?.[name]
              if (
                artifact.type === 'extrudeGroup' ||
                artifact.type === 'sketchGroup'
              ) {
                return artifact
              }
              return null
            })
            .filter((a) => a) as (ExtrudeGroup | SketchGroup)[]

          // console.log(programMemory)
          setError()
        })
        .catch(e => {
          if (e instanceof KCLError) {
            console.log("KCL error, handling")
            addKCLError(e)
          } else {
            console.log("non-KCL error, rethrowing")
            throw e
          }
        })
      } catch (e: any) {
        if (e instanceof KCLError) {
          addKCLError(e)
        } else {
          setError('problem')
          console.log(e)
          addLog(e)
        }
      }
    }
    asyncWrap()
  }, [code, isStreamReady])
  return (
    <div className="h-screen">
      <AppHeader />
      <ModalContainer />
      <Allotment snap={true}>
        <Allotment vertical defaultSizes={[5, 400, 1, 1]} minSize={20}>
          <SetToken />
          <div className="h-full flex flex-col items-start">
            <PanelHeader title="Editor" />
            <button
              // disabled={!shouldFormat}
              onClick={formatCode}
              // className={`${!shouldFormat && 'text-gray-300'}`}
            >
              format
            </button>
            <div
              className="bg-red h-full w-full overflow-auto"
              id="code-mirror-override"
            >
              <CodeMirror
                className="h-full"
                value={code}
                extensions={[javascript({ jsx: true }), lineHighlightField]}
                onChange={onChange}
                onUpdate={onUpdate}
                onCreateEditor={(_editorView) => setEditorView(_editorView)}
              />
            </div>
          </div>
          <MemoryPanel />
          <Logs />
          <KCLErrors />
        </Allotment>
        <Allotment vertical defaultSizes={[40, 400]} minSize={20}>
          <Stream />
        </Allotment>
        {debugPanel && <DebugPanel />}
      </Allotment>
    </div>
  )
}
