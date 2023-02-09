import { useStore } from './useStore'
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
        <>
          <button
            onClick={() => {
              setGuiMode({
                mode: 'sketch',
                sketchMode: 'selectFace',
              })
            }}
            className="border m-1 px-1 rounded"
          >
            Start sketch
          </button>
          <button
            onClick={() => {
              setGuiMode({
                mode: 'sketch',
                sketchMode: 'selectFace2',
              })
            }}
            className="border m-1 px-1 rounded"
          >
            StartSketchV2
          </button>
        </>
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
        /*guiMode.mode === 'canEditExtrude'*/ <button
          onClick={() => {
            setGuiMode({
              mode: 'sketch',
              sketchMode: 'sketchEdit',
              pathToNode: guiMode.pathToNode,
              rotation: guiMode.rotation,
              position: guiMode.position,
            })
          }}
          className="border m-1 px-1 rounded"
        >
          EditSketch
        </button>
      )}
      {(guiMode.mode === 'canEditSketch2' || false) && (
        <button
          onClick={() => {
            setGuiMode({
              mode: 'sketch',
              sketchMode: 'sketchEdit2',
              pathToNode: guiMode.pathToNode,
              rotation: guiMode.rotation,
              position: guiMode.position,
              isTooltip: true,
            })
          }}
          className="border m-1 px-1 rounded"
        >
          EditSketchV2
        </button>
      )}
      {guiMode.mode === 'canEditSketch' && (
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
      )}

      {guiMode.mode === 'sketch' && (
        <button
          onClick={() => setGuiMode({ mode: 'default' })}
          className="border m-1 px-1 rounded"
        >
          Exit sketch
        </button>
      )}
      {guiMode.mode === 'sketch' &&
        (guiMode.sketchMode === 'points' ||
          guiMode.sketchMode === 'sketchEdit') && (
          <button
            className={`border m-1 px-1 rounded ${
              guiMode.sketchMode === 'points' && 'bg-gray-400'
            }`}
            onClick={() =>
              setGuiMode({
                ...guiMode,
                isTooltip: true,
                sketchMode:
                  guiMode.sketchMode === 'points' ? 'sketchEdit' : 'points',
              })
            }
          >
            LineTo{guiMode.sketchMode === 'points' && '✅'}
          </button>
        )}
      {guiMode.mode === 'sketch' && 'isTooltip' in guiMode && (
        <button
          className={`border m-1 px-1 rounded ${
            guiMode.sketchMode === 'points2' && 'bg-gray-400'
          }`}
          onClick={() =>
            setGuiMode({
              ...guiMode,
              sketchMode:
                guiMode.sketchMode === 'points2' ? 'sketchEdit2' : 'points2',
            })
          }
        >
          LineTo{guiMode.sketchMode === 'points2' && '✅'}
        </button>
      )}
      {guiMode.mode === 'sketch' && 'isTooltip' in guiMode && (
        <button
          className={`border m-1 px-1 rounded ${
            guiMode.sketchMode === 'relativeLine' && 'bg-gray-400'
          }`}
          onClick={() =>
            setGuiMode({
              ...guiMode,
              sketchMode:
                guiMode.sketchMode === 'relativeLine'
                  ? 'sketchEdit2'
                  : 'relativeLine',
            })
          }
        >
          Relative Line{guiMode.sketchMode === 'relativeLine' && '✅'}
        </button>
      )}
      {guiMode.mode === 'sketch' && 'isTooltip' in guiMode && (
        <button
          className={`border m-1 px-1 rounded ${
            guiMode.sketchMode === 'angledLine' && 'bg-gray-400'
          }`}
          onClick={() =>
            setGuiMode({
              ...guiMode,
              sketchMode:
                guiMode.sketchMode === 'angledLine'
                  ? 'sketchEdit2'
                  : 'angledLine',
            })
          }
        >
          AngledLine{guiMode.sketchMode === 'angledLine' && '✅'}
        </button>
      )}
      {guiMode.mode === 'sketch' && 'isTooltip' in guiMode && (
        <button
          className={`border m-1 px-1 rounded ${
            guiMode.sketchMode === 'xLine' && 'bg-gray-400'
          }`}
          onClick={() =>
            setGuiMode({
              ...guiMode,
              sketchMode:
                guiMode.sketchMode === 'xLine' ? 'sketchEdit2' : 'xLine',
            })
          }
        >
          xLine{guiMode.sketchMode === 'xLine' && '✅'}
        </button>
      )}
      {guiMode.mode === 'sketch' && 'isTooltip' in guiMode && (
        <button
          className={`border m-1 px-1 rounded ${
            guiMode.sketchMode === 'yLine' && 'bg-gray-400'
          }`}
          onClick={() =>
            setGuiMode({
              ...guiMode,
              sketchMode:
                guiMode.sketchMode === 'yLine' ? 'sketchEdit2' : 'yLine',
            })
          }
        >
          yLine{guiMode.sketchMode === 'yLine' && '✅'}
        </button>
      )}
      {guiMode.mode === 'sketch' && 'isTooltip' in guiMode && (
        <button
          className={`border m-1 px-1 rounded ${
            guiMode.sketchMode === 'xLineTo' && 'bg-gray-400'
          }`}
          onClick={() =>
            setGuiMode({
              ...guiMode,
              sketchMode:
                guiMode.sketchMode === 'xLineTo' ? 'sketchEdit2' : 'xLineTo',
            })
          }
        >
          xLineTo{guiMode.sketchMode === 'xLineTo' && '✅'}
        </button>
      )}
      {guiMode.mode === 'sketch' && 'isTooltip' in guiMode && (
        <button
          className={`border m-1 px-1 rounded ${
            guiMode.sketchMode === 'yLineTo' && 'bg-gray-400'
          }`}
          onClick={() =>
            setGuiMode({
              ...guiMode,
              sketchMode:
                guiMode.sketchMode === 'yLineTo' ? 'sketchEdit2' : 'yLineTo',
            })
          }
        >
          yLineTo{guiMode.sketchMode === 'yLineTo' && '✅'}
        </button>
      )}
      {guiMode.mode === 'sketch' && 'isTooltip' in guiMode && (
        <button
          className={`border m-1 px-1 rounded ${
            guiMode.sketchMode === 'angledLineOfXLength' && 'bg-gray-400'
          }`}
          onClick={() =>
            setGuiMode({
              ...guiMode,
              sketchMode:
                guiMode.sketchMode === 'angledLineOfXLength'
                  ? 'sketchEdit2'
                  : 'angledLineOfXLength',
            })
          }
        >
          angledLineOfXLength
          {guiMode.sketchMode === 'angledLineOfXLength' && '✅'}
        </button>
      )}
      {guiMode.mode === 'sketch' && 'isTooltip' in guiMode && (
        <button
          className={`border m-1 px-1 rounded ${
            guiMode.sketchMode === 'angledLineOfYLength' && 'bg-gray-400'
          }`}
          onClick={() =>
            setGuiMode({
              ...guiMode,
              sketchMode:
                guiMode.sketchMode === 'angledLineOfYLength'
                  ? 'sketchEdit2'
                  : 'angledLineOfYLength',
            })
          }
        >
          angledLineOfYLength
          {guiMode.sketchMode === 'angledLineOfYLength' && '✅'}
        </button>
      )}
      {guiMode.mode === 'sketch' && 'isTooltip' in guiMode && (
        <button
          className={`border m-1 px-1 rounded ${
            guiMode.sketchMode === 'angledLineToX' && 'bg-gray-400'
          }`}
          onClick={() =>
            setGuiMode({
              ...guiMode,
              sketchMode:
                guiMode.sketchMode === 'angledLineToX'
                  ? 'sketchEdit2'
                  : 'angledLineToX',
            })
          }
        >
          angledLineToX{guiMode.sketchMode === 'angledLineToX' && '✅'}
        </button>
      )}
      {guiMode.mode === 'sketch' && 'isTooltip' in guiMode && (
        <button
          className={`border m-1 px-1 rounded ${
            guiMode.sketchMode === 'angledLineToY' && 'bg-gray-400'
          }`}
          onClick={() =>
            setGuiMode({
              ...guiMode,
              sketchMode:
                guiMode.sketchMode === 'angledLineToY'
                  ? 'sketchEdit2'
                  : 'angledLineToY',
            })
          }
        >
          angledLineToY{guiMode.sketchMode === 'angledLineToY' && '✅'}
        </button>
      )}
    </div>
  )
}
