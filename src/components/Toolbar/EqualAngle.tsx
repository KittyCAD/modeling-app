import { useState, useEffect } from 'react'
import { toolTips, useStore } from '../../useStore'
import { Value, VariableDeclarator } from '../../lang/wasm'
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
import { kclManager } from 'lang/KclSinglton'
import { useModelingContext } from 'hooks/useModelingContext'

export const EqualAngle = () => {
  const { guiMode, selectionRanges, setCursor } = useStore((s) => ({
    guiMode: s.guiMode,
    selectionRanges: s.selectionRanges,
    setCursor: s.setCursor,
  }))
  const { context } = useModelingContext()
  const [enableEqual, setEnableEqual] = useState(false)
  const [transformInfos, setTransformInfos] = useState<TransformInfo[]>()
  useEffect(() => {
    const paths = selectionRanges.codeBasedSelections.map(({ range }) =>
      getNodePathFromSourceRange(kclManager.ast, range)
    )
    const nodes = paths.map(
      (pathToNode) => getNodeFromPath<Value>(kclManager.ast, pathToNode).node
    )
    const varDecs = paths.map(
      (pathToNode) =>
        getNodeFromPath<VariableDeclarator>(
          kclManager.ast,
          pathToNode,
          'VariableDeclarator'
        )?.node
    )
    const primaryLine = varDecs[0]
    const secondaryVarDecs = varDecs.slice(1)
    const isOthersLinkedToPrimary = secondaryVarDecs.every((secondary) =>
      isSketchVariablesLinked(secondary, primaryLine, kclManager.ast)
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
      kclManager.ast,
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
        if (!transformInfos) return
        const { modifiedAst, pathToNodeMap } =
          transformSecondarySketchLinesTagFirst({
            ast: kclManager.ast,
            selectionRanges,
            transformInfos,
            programMemory: kclManager.programMemory,
          })
        kclManager.updateAst(context.defaultPlanes.planes, modifiedAst, true, {
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
