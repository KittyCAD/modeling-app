import { useState, useEffect } from 'react'
import { TooTip, useStore } from '../../useStore'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
  Value,
  CallExpression,
} from '../../lang/abstractSyntaxTree'
import { toolTips } from '../../useStore'
import { allowedTransforms } from '../../lang/std/sketch'
import { swapSketchHelper } from '../../lang/std/sketchConstraints'

export const HorzVert = () => {
  const { guiMode, selectionRanges, ast, programMemory, updateAst } = useStore(
    (s) => ({
      guiMode: s.guiMode,
      ast: s.ast,
      updateAst: s.updateAst,
      selectionRanges: s.selectionRanges,
      programMemory: s.programMemory,
    })
  )
  const [enableHorz, setEnableHorz] = useState(false)
  const [enableVert, setEnableVert] = useState(false)
  const [allowedTransformsMap, setAllowedTransformsMap] = useState<
    ReturnType<typeof allowedTransforms>[]
  >([])
  useEffect(() => {
    if (!ast) return
    const islineFn = (expression: Value): boolean => {
      if (expression?.type !== 'CallExpression') return false
      if (!toolTips.includes(expression.callee.name as any)) return false
      return true
    }
    const paths = selectionRanges.map((selectionRange) =>
      getNodePathFromSourceRange(ast, selectionRange)
    )
    const nodes = paths.map(
      (pathToNode) => getNodeFromPath<Value>(ast, pathToNode).node
    )
    const allowedSwaps = paths.map((a) =>
      allowedTransforms({
        node: ast,
        pathToNode: a,
        previousProgramMemory: programMemory,
      })
    )
    setAllowedTransformsMap(allowedSwaps)
    const allowedSwapsnames = allowedSwaps.map((a) =>
      Object.keys(a)
    ) as TooTip[][]
    const horzAllowed = includedInAll(allowedSwapsnames, ['xLine', 'xLineTo'])
    const vertAllowed = includedInAll(allowedSwapsnames, ['yLine', 'yLineTo'])
    const isCursorsInLineFns = nodes.every(islineFn)
    const _enableHorz =
      isCursorsInLineFns &&
      horzAllowed &&
      guiMode.mode === 'sketch' &&
      guiMode.sketchMode === 'sketchEdit'
    if (enableHorz !== _enableHorz) setEnableHorz(_enableHorz)
    const _enableVert =
      isCursorsInLineFns &&
      vertAllowed &&
      guiMode.mode === 'sketch' &&
      guiMode.sketchMode === 'sketchEdit'
    if (enableVert !== _enableVert) setEnableVert(_enableVert)
  }, [guiMode, selectionRanges, guiMode])
  if (guiMode.mode !== 'sketch') return null

  const onClick = (vertOrHor: 'vert' | 'horz') => () => {
    if (ast) {
      // deep clone since we are mutating in a loop, of which any could fail
      let node = JSON.parse(JSON.stringify(ast))
      selectionRanges.forEach((range, index) => {
        const { node: callExpression } = getNodeFromPath<CallExpression>(
          node,
          getNodePathFromSourceRange(node, range)
        )
        const [relLine, absLine]: [TooTip, TooTip] =
          vertOrHor === 'vert' ? ['yLine', 'yLineTo'] : ['xLine', 'xLineTo']
        const finalLine = [
          'line',
          'angledLine',
          'angledLineOfXLength',
          'angledLineOfYLength',
        ].includes(callExpression.callee.name)
          ? relLine
          : absLine
        const createCallBackHelper = allowedTransformsMap[index][finalLine]
        if (!createCallBackHelper) throw new Error('no callback helper')
        const { modifiedAst } = swapSketchHelper(
          programMemory,
          node,
          range,
          finalLine,
          createCallBackHelper
        )
        node = modifiedAst
      })
      updateAst(node)
    }
  }

  return (
    <>
      <button
        onClick={onClick('horz')}
        className={`border m-1 px-1 rounded ${
          enableHorz ? 'bg-gray-50 text-gray-800' : 'bg-gray-200 text-gray-400'
        }`}
        disabled={!enableHorz}
        title="yo dawg"
      >
        Horz
      </button>
      <button
        onClick={onClick('vert')}
        className={`border m-1 px-1 rounded ${
          enableVert ? 'bg-gray-50 text-gray-800' : 'bg-gray-200 text-gray-400'
        }`}
        disabled={!enableVert}
      >
        Vert
      </button>
    </>
  )
}

function includedInAll(
  allowedsOfEach: TooTip[][],
  isIncludes: TooTip[]
): boolean {
  return allowedsOfEach.every((alloweds) =>
    isIncludes.some((isInclude) => alloweds.includes(isInclude))
  )
}
