import { useState, useEffect } from 'react'
import { toolTips, useStore, TooTip } from '../../useStore'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
  Value,
  VariableDeclarator,
} from '../../lang/abstractSyntaxTree'
import {
  isSketchVariablesLinked,
  includedInAll,
  swapSketchHelper,
} from '../../lang/std/sketchConstraints'
import { allowedTransforms } from '../../lang/std/sketch'
import { giveSketchFnCallTag } from '../../lang/modifyAst'

export const Equal = () => {
  const { guiMode, selectionRanges, ast, programMemory, updateAst } = useStore(
    (s) => ({
      guiMode: s.guiMode,
      ast: s.ast,
      updateAst: s.updateAst,
      selectionRanges: s.selectionRanges,
      programMemory: s.programMemory,
    })
  )
  const [enableEqual, setEnableEqual] = useState(false)
  const [allowedTransformsMap, setAllowedTransformsMap] = useState<
    ReturnType<typeof allowedTransforms>[]
  >([])
  useEffect(() => {
    if (!ast) return
    const paths = selectionRanges.map((selectionRange) =>
      getNodePathFromSourceRange(ast, selectionRange)
    )
    const nodes = paths.map(
      (pathToNode) => getNodeFromPath<Value>(ast, pathToNode).node
    )
    const varDecs = paths.map(
      (pathToNode) =>
        getNodeFromPath<VariableDeclarator>(
          ast,
          pathToNode,
          'VariableDeclarator'
        )?.node
    )
    const primaryLine = varDecs[0]
    const secondaryVarDecs = varDecs.slice(1)
    const isOthersLinkedToPrimary = secondaryVarDecs.every((secondary) =>
      isSketchVariablesLinked(secondary, primaryLine, ast)
    )
    const isAllTooltips = nodes.every(
      (node) =>
        node?.type === 'CallExpression' &&
        toolTips.includes(node.callee.name as any)
    )

    const allowedSwaps = paths.slice(1).map((a) =>
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
    const hasCorrectTransforms = includedInAll(allowedSwapsnames, [
      'angledLine',
    ])
    const _enableEqual =
      !!secondaryVarDecs.length &&
      isAllTooltips &&
      isOthersLinkedToPrimary &&
      hasCorrectTransforms
    setEnableEqual(_enableEqual)
  }, [guiMode, selectionRanges])
  if (guiMode.mode !== 'sketch') return null

  const onClick = () => {
    if (!ast) return

    // deep clone since we are mutating in a loop, of which any could fail
    let node = JSON.parse(JSON.stringify(ast))
    const primarySelection = selectionRanges[0]

    // Add tag to primarySelection fn call
    node = giveSketchFnCallTag(node, primarySelection)

    selectionRanges.slice(1).forEach((range, index) => {
      const createCallBackHelper = allowedTransformsMap[index]['angledLine']
      if (!createCallBackHelper) throw new Error('no callback helper')
      const { modifiedAst } = swapSketchHelper(
        programMemory,
        node,
        range,
        'angledLine',
        createCallBackHelper
      )
      node = modifiedAst
    })
    updateAst(node)
  }

  return (
    <button
      onClick={onClick}
      className={`border m-1 px-1 rounded ${
        enableEqual ? 'bg-gray-50 text-gray-800' : 'bg-gray-200 text-gray-400'
      }`}
      disabled={!enableEqual}
      title="yo dawg"
    >
      Equal
    </button>
  )
}
