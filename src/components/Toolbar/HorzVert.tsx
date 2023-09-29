import { useState, useEffect } from 'react'
import { toolTips, useStore } from '../../useStore'
import { Value } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
} from '../../lang/queryAst'
import {
  TransformInfo,
  getTransformInfos,
  transformAstSketchLines,
} from '../../lang/std/sketchcombos'
import { updateCursors } from '../../lang/util'
import { ActionIcon } from 'components/ActionIcon'
import { sketchButtonClassnames } from 'Toolbar'
import { kclManager } from 'lang/KclSinglton'

export const HorzVert = ({
  horOrVert,
}: {
  horOrVert: 'vertical' | 'horizontal'
}) => {
  const { guiMode, selectionRanges, programMemory, updateAst, setCursor } =
    useStore((s) => ({
      guiMode: s.guiMode,
      updateAst: s.updateAst,
      selectionRanges: s.selectionRanges,
      programMemory: s.programMemory,
      setCursor: s.setCursor,
    }))
  const [enableHorz, setEnableHorz] = useState(false)
  const [transformInfos, setTransformInfos] = useState<TransformInfo[]>()
  useEffect(() => {
    const paths = selectionRanges.codeBasedSelections.map(({ range }) =>
      getNodePathFromSourceRange(kclManager.ast, range)
    )
    const nodes = paths.map(
      (pathToNode) => getNodeFromPath<Value>(kclManager.ast, pathToNode).node
    )
    const isAllTooltips = nodes.every(
      (node) =>
        node?.type === 'CallExpression' &&
        toolTips.includes(node.callee.name as any)
    )

    const theTransforms = getTransformInfos(
      selectionRanges,
      kclManager.ast,
      horOrVert
    )
    setTransformInfos(theTransforms)

    const _enableHorz = isAllTooltips && theTransforms.every(Boolean)
    setEnableHorz(_enableHorz)
  }, [guiMode, selectionRanges])
  if (guiMode.mode !== 'sketch') return null

  return (
    <button
      onClick={() => {
        if (!transformInfos) return
        const { modifiedAst, pathToNodeMap } = transformAstSketchLines({
          ast: kclManager.ast,
          selectionRanges,
          transformInfos,
          programMemory,
          referenceSegName: '',
        })
        updateAst(modifiedAst, true, {
          callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      }}
      disabled={!enableHorz}
      className="group"
      title={horOrVert === 'horizontal' ? 'Horizontal' : 'Vertical'}
    >
      <ActionIcon
        icon={horOrVert === 'horizontal' ? 'horizontal' : 'vertical'}
        className="!p-0.5"
        bgClassName={sketchButtonClassnames.background}
        iconClassName={sketchButtonClassnames.icon}
        size="md"
      />
      {horOrVert === 'horizontal' ? 'Horizontal' : 'Vertical'}
    </button>
  )
}
