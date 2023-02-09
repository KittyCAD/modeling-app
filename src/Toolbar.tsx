import { useStore, toolTips } from './useStore'
import { extrudeSketch, sketchOnExtrudedFace } from './lang/modifyAst'
import { getNodePathFromSourceRange } from './lang/abstractSyntaxTree'

export const Toolbar = () => {
  const { setGuiMode, guiMode, selectionRange, ast, updateAst } = useStore(
    ({ guiMode, setGuiMode, selectionRange, ast, updateAst }) => ({
      guiMode,
      setGuiMode,
      selectionRange,
      ast,
      updateAst,
    })
  )

  return (
    <div>
      {guiMode.mode === 'default' && (
        <button
          onClick={() => {
            setGuiMode({
              mode: 'sketch',
              sketchMode: 'selectFace',
            })
          }}
          className="border m-1 px-1 rounded"
        >
          Start Sketch
        </button>
      )}
      {guiMode.mode === 'canEditExtrude' && (
        <button
          onClick={() => {
            if (!ast) return
            const pathToNode = getNodePathFromSourceRange(ast, selectionRange)
            const { modifiedAst } = sketchOnExtrudedFace(ast, pathToNode)
            updateAst(modifiedAst)
          }}
          className="border m-1 px-1 rounded"
        >
          SketchOnFace
        </button>
      )}
      {(guiMode.mode === 'canEditSketch' || false) && (
        <button
          onClick={() => {
            setGuiMode({
              mode: 'sketch',
              sketchMode: 'sketchEdit',
              pathToNode: guiMode.pathToNode,
              rotation: guiMode.rotation,
              position: guiMode.position,
              isTooltip: true,
            })
          }}
          className="border m-1 px-1 rounded"
        >
          Edit Sketch
        </button>
      )}
      {/* TODO enable again */}
      {/* {guiMode.mode === 'canEditSketch' && (
        <>
          <button
            onClick={() => {
              if (!ast) return
              const pathToNode = getNodePathFromSourceRange(ast, selectionRange)
              const { modifiedAst, pathToExtrudeArg } = extrudeSketch(
                ast,
                pathToNode
              )
              updateAst(modifiedAst, pathToExtrudeArg)
            }}
            className="border m-1 px-1 rounded"
          >
            ExtrudeSketch
          </button>
          <button
            onClick={() => {
              if (!ast) return
              const pathToNode = getNodePathFromSourceRange(ast, selectionRange)
              const { modifiedAst, pathToExtrudeArg } = extrudeSketch(
                ast,
                pathToNode,
                false
              )
              updateAst(modifiedAst, pathToExtrudeArg)
            }}
            className="border m-1 px-1 rounded"
          >
            ExtrudeSketch (w/o pipe)
          </button>
        </>
      )} */}

      {guiMode.mode === 'sketch' && (
        <button
          onClick={() => setGuiMode({ mode: 'default' })}
          className="border m-1 px-1 rounded"
        >
          Exit sketch
        </button>
      )}
      {toolTips.map((sketchFnName) => {
        if (guiMode.mode !== 'sketch' || !('isTooltip' in guiMode)) return null
        return (
          <button
            key={sketchFnName}
            className={`border m-1 px-1 rounded ${
              guiMode.sketchMode === sketchFnName && 'bg-gray-400'
            }`}
            onClick={() =>
              setGuiMode({
                ...guiMode,
                sketchMode:
                  guiMode.sketchMode === sketchFnName
                    ? 'sketchEdit'
                    : (sketchFnName as any),
              })
            }
          >
            {sketchFnName}
            {guiMode.sketchMode === sketchFnName && '✅'}
          </button>
        )
      })}
    </div>
  )
}
