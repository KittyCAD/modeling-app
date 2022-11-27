import { useRef, useState, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { Allotment } from 'allotment'
import { OrbitControls, OrthographicCamera } from '@react-three/drei'
import { lexer } from './lang/tokeniser'
import { abstractSyntaxTree } from './lang/abstractSyntaxTree'
import { executor } from './lang/executor'
import { BufferGeometry } from 'three'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { ViewUpdate } from '@codemirror/view'
import {
  lineHighlightField,
  addLineHighlight,
} from './editor/highlightextension'
import { useStore } from './useStore'
import { isOverlapping } from './lib/utils'
import { Toolbar } from './Toolbar'
import { BasePlanes } from './components/BasePlanes'
import { SketchPlane } from './components/SketchPlane'
import { Logs } from './components/Logs'


const OrrthographicCamera = OrthographicCamera as any

function App() {
  const cam = useRef()
  const {
    editorView,
    setEditorView,
    setSelectionRange,
    selectionRange,
    guiMode,
    setGuiMode,
    lastGuiMode,
    removeError,
    addLog,
    code,
    setCode,
    setAst,
  } = useStore((s) => ({
    editorView: s.editorView,
    setEditorView: s.setEditorView,
    setSelectionRange: s.setSelectionRange,
    selectionRange: s.selectionRange,
    guiMode: s.guiMode,
    setGuiMode: s.setGuiMode,
    removeError: s.removeError,
    addLog: s.addLog,
    code: s.code,
    setCode: s.setCode,
    ast: s.ast,
    setAst: s.setAst,
    lastGuiMode: s.lastGuiMode
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
    const range = viewUpdate.state.selection.ranges[0]
    const isNoChange =
      range.from === selectionRange[0] && range.to === selectionRange[1]
    if (isNoChange) return
    setSelectionRange([range.from, range.to])
  }
  const [geoArray, setGeoArray] = useState<
    { geo: BufferGeometry; sourceRange: [number, number] }[]
  >([])
  useEffect(() => {
    try {
      if (!code) {
        setGeoArray([])
        setAst(null)
        removeError()
        return
      }
      const tokens = lexer(code)
      const _ast = abstractSyntaxTree(tokens)
      setAst(_ast)
      const programMemory = executor(_ast, {
        root: {
          log: (a: any) => {
            addLog(a)
          },
        },
        _sketch: [],
      })
      const geos: { geo: BufferGeometry; sourceRange: [number, number] }[] =
        programMemory?.return?.flatMap(
          ({ name }: { name: string }) =>
            programMemory?.root?.[name]
              ?.map(
                ({
                  geo,
                  sourceRange,
                }: {
                  geo: BufferGeometry
                  sourceRange: [number, number]
                }) => ({ geo, sourceRange })
              )
              .filter((a: any) => !!a.geo) || []
        ) || []
      setGeoArray(geos)
      removeError()
      console.log(programMemory)
    } catch (e: any) {
      setGuiMode({ mode: 'codeError' })
      console.log(e)
      addLog(e)
    }
  }, [code])
  return (
    <div className="h-screen">
      <Allotment>
        <Logs />
        <div className="bg-red h-full overflow-auto">
          <CodeMirror
            className="h-full"
            value={code}
            extensions={[javascript({ jsx: true }), lineHighlightField]}
            onChange={onChange}
            onUpdate={onUpdate}
            onCreateEditor={(_editorView) => setEditorView(_editorView)}
          />
        </div>
        <div className="h-full">
          <Toolbar />
          <div className="border h-full border-gray-300 relative">
            <div className="absolute inset-0">
              <Canvas>
                <OrbitControls
                  enableDamping={false}
                  enablePan
                  enableRotate
                  enableZoom
                  reverseOrbit={false}
                />
                <OrrthographicCamera
                  ref={cam}
                  makeDefault
                  position={[0, 0, 10]}
                  zoom={40}
                  rotation={[0, 0, 0]}
                />
                <ambientLight />
                <pointLight position={[10, 10, 10]} />
                {geoArray.map(
                  (
                    {
                      geo,
                      sourceRange,
                    }: { geo: BufferGeometry; sourceRange: [number, number] },
                    index
                  ) => (
                    <Line key={index} geo={geo} sourceRange={sourceRange} />
                  )
                )}
                <BasePlanes />
                <SketchPlane />
              </Canvas>
            </div>
            {guiMode.mode === 'codeError' && (
              <div className="absolute inset-0 bg-gray-700/20">
                <pre>{'last first: \n\n' + JSON.stringify(lastGuiMode, null, 2) + '\n\n' + JSON.stringify(guiMode)}</pre></div>
            )}
          </div>
        </div>
      </Allotment>
    </div>
  )
}

export default App

function Line({
  geo,
  sourceRange,
}: {
  geo: BufferGeometry
  sourceRange: [number, number]
}) {
  const { setHighlightRange, selectionRange } = useStore(
    ({ setHighlightRange, selectionRange }) => ({
      setHighlightRange,
      selectionRange,
    })
  )
  // This reference will give us direct access to the mesh
  const ref = useRef<BufferGeometry | undefined>() as any
  const [hovered, setHover] = useState(false)
  const [editorCursor, setEditorCursor] = useState(false)
  useEffect(() => {
    const shouldHighlight = isOverlapping(sourceRange, selectionRange)
    setEditorCursor(shouldHighlight)
  }, [selectionRange, sourceRange])

  return (
    <mesh
      ref={ref}
      onPointerOver={(event) => {
        setHover(true)
        setHighlightRange(sourceRange)
      }}
      onPointerOut={(event) => {
        setHover(false)
        setHighlightRange([0, 0])
      }}
    >
      <primitive object={geo} />
      <meshStandardMaterial
        color={hovered ? 'hotpink' : editorCursor ? 'skyblue' : 'orange'}
      />
    </mesh>
  )
}
