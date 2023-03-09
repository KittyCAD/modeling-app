import { useStore, toolTips } from './useStore'
import { extrudeSketch, sketchOnExtrudedFace } from './lang/modifyAst'
import { getNodePathFromSourceRange } from './lang/queryAst'
import { HorzVert } from './components/Toolbar/HorzVert'
import { Equal } from './components/Toolbar/Equal'
import { SetHorzDistance } from './components/Toolbar/SetHorzDistance'
import { SetAngleLength } from './components/Toolbar/SetAngleLength'

export const Toolbar = () => {
  const {
    setGuiMode,
    guiMode,
    selectionRanges,
    ast,
    updateAst,
    programMemory,
  } = useStore((s) => ({
    guiMode: s.guiMode,
    setGuiMode: s.setGuiMode,
    selectionRanges: s.selectionRanges,
    ast: s.ast,
    updateAst: s.updateAst,
    programMemory: s.programMemory,
  }))

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
          className="border m-1 px-1 rounded text-xs"
        >
          Start Sketch
        </button>
      )}
      {guiMode.mode === 'canEditExtrude' && (
        <button
          onClick={() => {
            if (!ast) return
            const pathToNode = getNodePathFromSourceRange(
              ast,
              selectionRanges[0]
            )
            const { modifiedAst } = sketchOnExtrudedFace(
              ast,
              pathToNode,
              programMemory
            )
            updateAst(modifiedAst)
          }}
          className="border m-1 px-1 rounded text-xs"
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
            })
          }}
          className="border m-1 px-1 rounded text-xs"
        >
          Edit Sketch
        </button>
      )}
      {guiMode.mode === 'canEditSketch' && (
        <>
          <button
            onClick={() => {
              if (!ast) return
              const pathToNode = getNodePathFromSourceRange(
                ast,
                selectionRanges[0]
              )
              const { modifiedAst, pathToExtrudeArg } = extrudeSketch(
                ast,
                pathToNode
              )
              updateAst(modifiedAst, pathToExtrudeArg)
            }}
            className="border m-1 px-1 rounded text-xs"
          >
            ExtrudeSketch
          </button>
          <button
            onClick={() => {
              if (!ast) return
              const pathToNode = getNodePathFromSourceRange(
                ast,
                selectionRanges[0]
              )
              const { modifiedAst, pathToExtrudeArg } = extrudeSketch(
                ast,
                pathToNode,
                false
              )
              updateAst(modifiedAst, pathToExtrudeArg)
            }}
            className="border m-1 px-1 rounded text-xs"
          >
            ExtrudeSketch (w/o pipe)
          </button>
        </>
      )}

      {guiMode.mode === 'sketch' && (
        <button
          onClick={() => setGuiMode({ mode: 'default' })}
          className="border m-1 px-1 rounded text-xs"
        >
          Exit sketch
        </button>
      )}
      {toolTips.map((sketchFnName) => {
        if (
          guiMode.mode !== 'sketch' ||
          !('isTooltip' in guiMode || guiMode.sketchMode === 'sketchEdit')
        )
          return null
        return (
          <button
            key={sketchFnName}
            className={`border m-0.5 px-0.5 rounded text-xs ${
              guiMode.sketchMode === sketchFnName && 'bg-gray-400'
            }`}
            onClick={() =>
              setGuiMode({
                ...guiMode,
                ...(guiMode.sketchMode === sketchFnName
                  ? {
                      sketchMode: 'sketchEdit',
                      // todo: ...guiMod is adding isTooltip: true, will probably just fix with xstate migtaion
                    }
                  : {
                      sketchMode: sketchFnName,
                      isTooltip: true,
                    }),
              })
            }
          >
            {sketchFnName}
            {guiMode.sketchMode === sketchFnName && '✅'}
          </button>
        )
      })}
      <br></br>
      <HorzVert horOrVert="horizontal" />
      <HorzVert horOrVert="vertical" />
      <Equal />
      <SetHorzDistance horOrVert="setHorzDistance" />
      <SetHorzDistance horOrVert="setVertDistance" />
      <SetAngleLength angleOrLength="setAngle" />
      <SetAngleLength angleOrLength="setLength" />
    </div>
  )
}
