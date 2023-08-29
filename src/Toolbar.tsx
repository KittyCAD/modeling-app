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
import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPen, faSearch } from '@fortawesome/free-solid-svg-icons'
import { Popover } from '@headlessui/react'
import { ActionButton } from 'components/ActionButton'

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
    <Popover className="relative">
      <div className="flex gap-4 items-center rounded-full border border-cool-20/30 dark:border-cool-100/50 bg-cool-10/50 dark:bg-cool-120/50">
        <span className="self-stretch flex items-center px-4 py-1 bg-cool-20/50 dark:bg-cool-90/50 text-cool-100 dark:text-cool-30 rounded-l-full text-sm font-bold">
          {guiMode.mode === 'sketch' ? '2D' : '3D'}
        </span>
        <menu className="flex flex-1 gap-2 py-0.5">
          <ActionButton
            Element="button"
            icon={{ icon: faPen, size: 'sm' }}
            onClick={() => {
              setGuiMode({
                mode: 'sketch',
                sketchMode: 'selectFace',
              })
            }}
            className="py-0 px-0.5 bg-chalkboard-10 dark:bg-chalkboard-100"
          >
            Start Sketch
          </ActionButton>
        </menu>
        <Popover.Button className="self-stretch m-0 flex items-center px-4 py-1 bg-cool-20/50 dark:bg-cool-90/50 hover:bg-cool-20 dark:hover:bg-cool-90 text-cool-100 dark:text-cool-30 rounded-r-full border-none text-sm font-bold">
          <FontAwesomeIcon icon={faSearch} />
        </Popover.Button>
      </div>
      <Popover.Overlay className="fixed inset-0 bg-chalkboard-110/20 dark:bg-chalkboard-110/50" />
      <Popover.Panel className="absolute top-0 w-screen max-w-xl left-1/2 -translate-x-1/2 bg-chalkboard-10 dark:bg-chalkboard-100 p-5 rounded border border-chalkboard-20/30 dark:border-chalkboard-70/50">
        Open!
        <Popover.Button>Close</Popover.Button>
      </Popover.Panel>
      {/* // <div>
    //   {guiMode.mode === 'default' && (
    //     <button
    //       onClick={() => {
    //         setGuiMode({
    //           mode: 'sketch',
    //           sketchMode: 'selectFace',
    //         })
    //       }}
    //     >
    //       Start Sketch
    //     </button>
    //   )}
    //   {guiMode.mode === 'canEditExtrude' && (
    //     <button
    //       onClick={() => {
    //         if (!ast) return
    //         const pathToNode = getNodePathFromSourceRange(
    //           ast,
    //           selectionRanges.codeBasedSelections[0].range
    //         )
    //         const { modifiedAst } = sketchOnExtrudedFace(
    //           ast,
    //           pathToNode,
    //           programMemory
    //         )
    //         updateAst(modifiedAst)
    //       }}
    //     >
    //       SketchOnFace
    //     </button>
    //   )}
    //   {(guiMode.mode === 'canEditSketch' || false) && (
    //     <button
    //       onClick={() => {
    //         setGuiMode({
    //           mode: 'sketch',
    //           sketchMode: 'sketchEdit',
    //           pathToNode: guiMode.pathToNode,
    //           rotation: guiMode.rotation,
    //           position: guiMode.position,
    //         })
    //       }}
    //     >
    //       Edit Sketch
    //     </button>
    //   )}
    //   {guiMode.mode === 'canEditSketch' && (
    //     <>
    //       <button
    //         onClick={() => {
    //           if (!ast) return
    //           const pathToNode = getNodePathFromSourceRange(
    //             ast,
    //             selectionRanges.codeBasedSelections[0].range
    //           )
    //           const { modifiedAst, pathToExtrudeArg } = extrudeSketch(
    //             ast,
    //             pathToNode
    //           )
    //           updateAst(modifiedAst, { focusPath: pathToExtrudeArg })
    //         }}
    //       >
    //         ExtrudeSketch
    //       </button>
    //       <button
    //         onClick={() => {
    //           if (!ast) return
    //           const pathToNode = getNodePathFromSourceRange(
    //             ast,
    //             selectionRanges.codeBasedSelections[0].range
    //           )
    //           const { modifiedAst, pathToExtrudeArg } = extrudeSketch(
    //             ast,
    //             pathToNode,
    //             false
    //           )
    //           updateAst(modifiedAst, { focusPath: pathToExtrudeArg })
    //         }}
    //       >
    //         ExtrudeSketch (w/o pipe)
    //       </button>
    //     </>
    //   )}

    //   {guiMode.mode === 'sketch' && (
    //     <button onClick={() => setGuiMode({ mode: 'default' })}>
    //       Exit sketch
    //     </button>
    //   )}
    //   {toolTips
    //     .filter(
    //       // (sketchFnName) => !['angledLineThatIntersects'].includes(sketchFnName)
    //       (sketchFnName) => ['line'].includes(sketchFnName)
    //     )
    //     .map((sketchFnName) => {
    //       if (
    //         guiMode.mode !== 'sketch' ||
    //         !('isTooltip' in guiMode || guiMode.sketchMode === 'sketchEdit')
    //       )
    //         return null
    //       return (
    //         <button
    //           key={sketchFnName}
    //           onClick={() =>
    //             setGuiMode({
    //               ...guiMode,
    //               ...(guiMode.sketchMode === sketchFnName
    //                 ? {
    //                     sketchMode: 'sketchEdit',
    //                     // todo: ...guiMod is adding isTooltip: true, will probably just fix with xstate migtaion
    //                   }
    //                 : {
    //                     sketchMode: sketchFnName,
    //                     isTooltip: true,
    //                   }),
    //             })
    //           }
    //         >
    //           {sketchFnName}
    //           {guiMode.sketchMode === sketchFnName && '✅'}
    //         </button>
    //       )
    //     })}
    //   <br></br>
    //   <ConvertToVariable />
    //   <HorzVert horOrVert="horizontal" />
    //   <HorzVert horOrVert="vertical" />
    //   <EqualLength />
    //   <EqualAngle />
    //   <SetHorzVertDistance buttonType="alignEndsVertically" />
    //   <SetHorzVertDistance buttonType="setHorzDistance" />
    //   <SetAbsDistance buttonType="snapToYAxis" />
    //   <SetAbsDistance buttonType="xAbs" />
    //   <SetHorzVertDistance buttonType="alignEndsHorizontally" />
    //   <SetAbsDistance buttonType="snapToXAxis" />
    //   <SetHorzVertDistance buttonType="setVertDistance" />
    //   <SetAbsDistance buttonType="yAbs" />
    //   <SetAngleLength angleOrLength="setAngle" />
    //   <SetAngleLength angleOrLength="setLength" />
    //   <Intersect />
    //   <RemoveConstrainingValues />
    //   <SetAngleBetween />
    // </div> */}
    </Popover>
  )
}
