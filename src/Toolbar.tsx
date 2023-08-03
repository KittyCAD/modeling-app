import { useStore, toolTips } from './useStore'
import { extrudeSketch, sketchOnExtrudedFace } from './lang/modifyAst'
import { getNodePathFromSourceRange } from './lang/queryAst'
import { HorzVert } from './components/Toolbar/HorzVert'
import { RemoveConstrainingValues } from './components/Toolbar/RemoveConstrainingValues'
import { EqualLength } from './components/Toolbar/EqualLength'
import { EqualAngle } from './components/Toolbar/EqualAngle'
import { Intersect } from './components/Toolbar/Intersect'
import { SetHorzVertDistance } from './components/Toolbar/SetHorzVertDistance'
import { SetAngleLength } from './components/Toolbar/setAngleLength'
import { ConvertToVariable } from './components/Toolbar/ConvertVariable'
import { SetAbsDistance } from './components/Toolbar/SetAbsDistance'
import { SetAngleBetween } from './components/Toolbar/SetAngleBetween'
import { ExportButton } from './components/ExportButton'

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
      <ExportButton />
      {guiMode.mode === 'default' && (
        <button
          onClick={() => {
            setGuiMode({
              mode: 'sketch',
              sketchMode: 'selectFace',
            })
          }}
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
              selectionRanges.codeBasedSelections[0].range
            )
            const { modifiedAst } = sketchOnExtrudedFace(
              ast,
              pathToNode,
              programMemory
            )
            updateAst(modifiedAst)
          }}
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
                selectionRanges.codeBasedSelections[0].range
              )
              const { modifiedAst, pathToExtrudeArg } = extrudeSketch(
                ast,
                pathToNode
              )
              updateAst(modifiedAst, { focusPath: pathToExtrudeArg })
            }}
          >
            ExtrudeSketch
          </button>
          <button
            onClick={() => {
              if (!ast) return
              const pathToNode = getNodePathFromSourceRange(
                ast,
                selectionRanges.codeBasedSelections[0].range
              )
              const { modifiedAst, pathToExtrudeArg } = extrudeSketch(
                ast,
                pathToNode,
                false
              )
              updateAst(modifiedAst, { focusPath: pathToExtrudeArg })
            }}
          >
            ExtrudeSketch (w/o pipe)
          </button>
        </>
      )}

      {guiMode.mode === 'sketch' && (
        <button onClick={() => setGuiMode({ mode: 'default' })}>
          Exit sketch
        </button>
      )}
      {toolTips
        .filter(
          // (sketchFnName) => !['angledLineThatIntersects'].includes(sketchFnName)
          (sketchFnName) => ['line'].includes(sketchFnName)
        )
        .map((sketchFnName) => {
          if (
            guiMode.mode !== 'sketch' ||
            !('isTooltip' in guiMode || guiMode.sketchMode === 'sketchEdit')
          )
            return null
          return (
            <button
              key={sketchFnName}
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
      <ConvertToVariable />
      <HorzVert horOrVert="horizontal" />
      <HorzVert horOrVert="vertical" />
      <EqualLength />
      <EqualAngle />
      <SetHorzVertDistance buttonType="alignEndsVertically" />
      <SetHorzVertDistance buttonType="setHorzDistance" />
      <SetAbsDistance buttonType="snapToYAxis" />
      <SetAbsDistance buttonType="xAbs" />
      <SetHorzVertDistance buttonType="alignEndsHorizontally" />
      <SetAbsDistance buttonType="snapToXAxis" />
      <SetHorzVertDistance buttonType="setVertDistance" />
      <SetAbsDistance buttonType="yAbs" />
      <SetAngleLength angleOrLength="setAngle" />
      <SetAngleLength angleOrLength="setLength" />
      <Intersect />
      <RemoveConstrainingValues />
      <SetAngleBetween />
    </div>
  )
}
