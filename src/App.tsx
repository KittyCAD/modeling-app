import { useRef, useEffect } from 'react'
import { Allotment } from 'allotment'
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
import { Toolbar } from './Toolbar'
import { Logs } from './components/Logs'
import { PanelHeader } from './components/PanelHeader'
import { MemoryPanel } from './components/MemoryPanel'
import { useHotKeyListener } from './hooks/useHotKeyListener'
import { Stream } from './components/Stream'
import ModalContainer from 'react-modal-promise'
import { EngineCommandManager } from './lang/std/engineConnection'
import { isOverlap } from './lib/utils'

export function App() {
  const cam = useRef()
  useHotKeyListener()
  const {
    editorView,
    setEditorView,
    setSelectionRanges,
    selectionRanges,
    guiMode,
    lastGuiMode,
    addLog,
    code,
    setCode,
    setAst,
    setError,
    errorState,
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
  } = useStore((s) => ({
    editorView: s.editorView,
    setEditorView: s.setEditorView,
    setSelectionRanges: s.setSelectionRanges,
    selectionRanges: s.selectionRanges,
    guiMode: s.guiMode,
    setGuiMode: s.setGuiMode,
    addLog: s.addLog,
    code: s.code,
    setCode: s.setCode,
    setAst: s.setAst,
    lastGuiMode: s.lastGuiMode,
    setError: s.setError,
    errorState: s.errorState,
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
    setMediaStream: s.setMediaStream
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
  useEffect(() => {
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
        const engineCommandManager = new EngineCommandManager(setMediaStream)
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
      } catch (e: any) {
        setError('problem')
        console.log(e)
        addLog(e)
      }
    }
    asyncWrap()
  }, [code])
  return (
    <div className="h-screen">
      <ModalContainer />
      <Allotment snap={true}>
        <Allotment vertical defaultSizes={[400, 1, 1]} minSize={20}>
          <div className="h-full flex flex-col items-start">
            <PanelHeader title="Editor" />
            {/* <button
              disabled={!shouldFormat}
              onClick={formatCode}
              className={`${!shouldFormat && 'text-gray-300'}`}
            >
              format
            </button> */}
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
        </Allotment>
        <Allotment vertical defaultSizes={[40, 400]} minSize={20}>
          <div>
            <Toolbar />
          </div>
          <Stream />
        </Allotment>
      </Allotment>
    </div>
  )
}
