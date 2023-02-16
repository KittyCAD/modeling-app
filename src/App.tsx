import { useRef, useState, useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { Allotment } from 'allotment'
import { OrbitControls, OrthographicCamera } from '@react-three/drei'
import { lexer } from './lang/tokeniser'
import { abstractSyntaxTree } from './lang/abstractSyntaxTree'
import { executor, ExtrudeGroup, SketchGroup } from './lang/executor'
import { recast } from './lang/recast'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { ViewUpdate } from '@codemirror/view'
import {
  lineHighlightField,
  addLineHighlight,
} from './editor/highlightextension'
import { useStore } from './useStore'
import { Toolbar } from './Toolbar'
import { BasePlanes } from './components/BasePlanes'
import { SketchPlane } from './components/SketchPlane'
import { Logs } from './components/Logs'
import { AxisIndicator } from './components/AxisIndicator'
import { RenderViewerArtifacts } from './components/RenderViewerArtifacts'
import { PanelHeader } from './components/PanelHeader'
import { MemoryPanel } from './components/MemoryPanel'
import { useHotKeyListener } from './hooks/useHotKeyListener'

const OrrthographicCamera = OrthographicCamera as any

function App() {
  const cam = useRef()
  useHotKeyListener()
  const {
    editorView,
    setEditorView,
    setSelectionRanges,
    selectionRanges: selectionRange,
    guiMode,
    lastGuiMode,
    addLog,
    code,
    setCode,
    setAst,
    // formatCode,
    ast,
    setError,
    errorState,
    setProgramMemory,
    resetLogs,
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
    ast: s.ast,
    setAst: s.setAst,
    lastGuiMode: s.lastGuiMode,
    // formatCode: s.formatCode,
    setError: s.setError,
    errorState: s.errorState,
    setProgramMemory: s.setProgramMemory,
    resetLogs: s.resetLogs,
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
      ranges.length !== selectionRange.length ||
      ranges.some(({ from, to }, i) => {
        return from !== selectionRange[i][0] || to !== selectionRange[i][1]
      })

    if (!isChange) return
    setSelectionRanges(ranges.map(({ from, to }) => [from, to]))
  }
  const [geoArray, setGeoArray] = useState<(ExtrudeGroup | SketchGroup)[]>([])
  useEffect(() => {
    try {
      if (!code) {
        setGeoArray([])
        setAst(null)
        return
      }
      const tokens = lexer(code)
      const _ast = abstractSyntaxTree(tokens)
      setAst(_ast)
      resetLogs()
      const programMemory = executor(_ast, {
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
        },
        _sketch: [],
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

      setGeoArray(geos)
      console.log(programMemory)
      setError()
    } catch (e: any) {
      setError('problem')
      console.log(e)
      addLog(e)
    }
  }, [code])
  // const shouldFormat = useMemo(() => {
  //   if (!ast) return false
  //   const recastedCode = recast(ast)
  //   return recastedCode !== code
  // }, [code, ast])
  return (
    <div className="h-screen">
      <Allotment snap={true}>
        <Allotment vertical defaultSizes={[4, 1, 1]}>
          <div className="h-full flex flex-col items-start">
            <PanelHeader title="Editor" />
            {/* <button
              disabled={!shouldFormat}
              onClick={formatCode}
              className={`${!shouldFormat && 'text-gray-300'}`}
            >
              format
            </button> */}
            <div className="bg-red h-full w-full overflow-auto">
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
        <div className="h-full">
          <PanelHeader title="Drafting Board" />
          <Toolbar />
          <div className="border h-full border-gray-300 relative">
            <div className="absolute inset-0">
              <Canvas>
                <OrbitControls
                  enableDamping={false}
                  enablePan
                  enableRotate={
                    !(
                      guiMode.mode === 'canEditSketch' ||
                      guiMode.mode === 'sketch'
                    )
                  }
                  enableZoom
                  reverseOrbit={false}
                />
                <OrrthographicCamera
                  ref={cam}
                  makeDefault
                  position={[0, 0, 1000]}
                  zoom={100}
                  rotation={[0, 0, 0]}
                  far={2000}
                />
                <ambientLight />
                <pointLight position={[10, 10, 10]} />
                <RenderViewerArtifacts artifacts={geoArray} />
                <BasePlanes />
                <SketchPlane />
                <AxisIndicator />
              </Canvas>
            </div>
            {errorState.isError && (
              <div className="absolute inset-0 bg-gray-700/20">
                <pre>
                  {'last first: \n\n' +
                    JSON.stringify(lastGuiMode, null, 2) +
                    '\n\n' +
                    JSON.stringify(guiMode)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </Allotment>
    </div>
  )
}

export default App
