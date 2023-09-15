import { useState, useEffect } from 'react'
import { toolTips, useStore } from '../../useStore'
import { Value, VariableDeclarator } from '../../lang/abstractSyntaxTreeTypes'
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
import { updateCursors } from '../../lang/util'
import { ActionIcon } from 'components/ActionIcon'
import { sketchButtonClassnames } from 'Toolbar'

export const EqualAngle = () => {
  const { guiMode, selectionRanges, ast, programMemory, updateAst, setCursor } =
    useStore((s) => ({
      guiMode: s.guiMode,
      ast: s.ast,
      updateAst: s.updateAst,
      selectionRanges: s.selectionRanges,
      programMemory: s.programMemory,
      setCursor: s.setCursor,
    }))
  const [enableEqual, setEnableEqual] = useState(false)
  const [transformInfos, setTransformInfos] = useState<TransformInfo[]>()
  useEffect(() => {
    if (!ast) return
    const paths = selectionRanges.codeBasedSelections.map(({ range }) =>
      getNodePathFromSourceRange(ast, range)
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
      {
        ...selectionRanges,
        codeBasedSelections: selectionRanges.codeBasedSelections.slice(1),
      },
      ast,
      'equalAngle'
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
      onClick={async () => {
        if (!(transformInfos && ast)) return
        const { modifiedAst, pathToNodeMap } =
          transformSecondarySketchLinesTagFirst({
            ast,
            selectionRanges,
            transformInfos,
            programMemory,
          })
        updateAst(modifiedAst, true, {
          callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      }}
      disabled={!enableEqual}
      title="Parallel (or equal angle)"
      className="group"
    >
      <ActionIcon
        icon="parallel"
        className="!p-0.5"
        bgClassName={sketchButtonClassnames.background}
        iconClassName={sketchButtonClassnames.icon}
        size="md"
      />
      Parallel
    </button>
  )
}
