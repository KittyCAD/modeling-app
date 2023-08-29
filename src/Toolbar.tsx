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
import { useEffect } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSearch, faX } from '@fortawesome/free-solid-svg-icons'
import { Popover } from '@headlessui/react'
import styles from './Toolbar.module.css'

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

  useEffect(() => {
    console.log('guiMode', guiMode)
  }, [guiMode])

  function ToolbarButtons() {
    return (
      <>
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
      </>
    )
  }

  return (
    <Popover className={styles.toolbarWrapper + ' ' + guiMode.mode}>
      <div className={styles.toolbar}>
        <span className={styles.toolbarCap + ' ' + styles.label}>
          {guiMode.mode === 'sketch' ? '2D' : '3D'}
        </span>
        <menu className="flex flex-1 gap-2 py-0.5 overflow-hidden whitespace-nowrap">
          <ToolbarButtons />
        </menu>
        <Popover.Button
          className={styles.toolbarCap + ' ' + styles.popoverToggle}
        >
          <FontAwesomeIcon icon={faSearch} />
        </Popover.Button>
      </div>
      <Popover.Overlay className="fixed inset-0 bg-chalkboard-110/20 dark:bg-chalkboard-110/50" />
      <Popover.Panel className="absolute top-0 w-screen max-w-xl left-1/2 -translate-x-1/2 flex flex-col gap-8 bg-chalkboard-10 dark:bg-chalkboard-100 p-5 rounded border border-chalkboard-20/30 dark:border-chalkboard-70/50">
        <section className="flex justify-between items-center">
          <p
            className={`${styles.toolbarCap} ${styles.label} !self-center rounded-r-full w-fit`}
          >
            You're in {guiMode.mode === 'sketch' ? '2D' : '3D'}
          </p>
          <Popover.Button className="p-2 flex items-center justify-center rounded-sm bg-chalkboard-20 text-chalkboard-110 dark:bg-chalkboard-70 dark:text-chalkboard-20 border-none hover:bg-chalkboard-30 dark:hover:bg-chalkboard-60">
            <FontAwesomeIcon icon={faX} className="w-4 h-4" />
          </Popover.Button>
        </section>
        <section>
          <ToolbarButtons />
        </section>
      </Popover.Panel>
    </Popover>
  )
}
