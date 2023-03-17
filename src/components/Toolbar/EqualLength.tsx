import { useState, useEffect } from 'react'
import { toolTips, useStore } from '../../useStore'
import { Value, VariableDeclarator } from '../../lang/abstractSyntaxTree'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
} from '../../lang/queryAst'
import { isSketchVariablesLinked } from '../../lang/std/sketchConstraints'
import {
  TransformInfo,
  transformSecondarySketchLinesTagFirst,
  getTransformInfos,
} from '../../lang/std/sketchcombos'

export const EqualLength = () => {
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
  const [transformInfos, setTransformInfos] = useState<TransformInfo[]>()
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

    const theTransforms = getTransformInfos(
      selectionRanges.slice(1),
      ast,
      'equalLength'
    )
    setTransformInfos(theTransforms)

    const _enableEqual =
      !!secondaryVarDecs.length &&
      isAllTooltips &&
      isOthersLinkedToPrimary &&
      theTransforms.every(Boolean)
    setEnableEqual(_enableEqual)
  }, [guiMode, selectionRanges])
  if (guiMode.mode !== 'sketch') return null

  return (
    <button
      onClick={() =>
        transformInfos &&
        ast &&
        updateAst(
          transformSecondarySketchLinesTagFirst({
            ast,
            selectionRanges,
            transformInfos,
            programMemory,
          })?.modifiedAst
        )
      }
      className={`border m-1 px-1 rounded text-xs ${
        enableEqual ? 'bg-gray-50 text-gray-800' : 'bg-gray-200 text-gray-400'
      }`}
      disabled={!enableEqual}
      title="yo dawg"
    >
      EqualLength
    </button>
  )
}
