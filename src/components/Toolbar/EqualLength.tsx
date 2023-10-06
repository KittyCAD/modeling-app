import { useState, useEffect } from 'react'
import { Selections, toolTips, useStore } from '../../useStore'
import { Program, Value, VariableDeclarator } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
} from '../../lang/queryAst'
import { isSketchVariablesLinked } from '../../lang/std/sketchConstraints'
import {
  TransformInfo,
  transformSecondarySketchLinesTagFirst,
  getTransformInfos,
  PathToNodeMap,
} from '../../lang/std/sketchcombos'
import { updateCursors } from '../../lang/util'
import { ActionIcon } from 'components/ActionIcon'
import { sketchButtonClassnames } from 'Toolbar'
import { kclManager } from 'lang/KclSinglton'

export const EqualLength = () => {
  const { guiMode, selectionRanges, setCursor } = useStore((s) => ({
    guiMode: s.guiMode,
    selectionRanges: s.selectionRanges,
    setCursor: s.setCursor,
  }))
  const [enableEqual, setEnableEqual] = useState(false)
  const [transformInfos, setTransformInfos] = useState<TransformInfo[]>()
  useEffect(() => {
    const { enabled, transforms } = setEqualLengthInfo({ selectionRanges })

    setTransformInfos(transforms)
    setEnableEqual(enabled)
  }, [guiMode, selectionRanges])
  if (guiMode.mode !== 'sketch') return null

  return (
    <button
      onClick={() => {
        if (!transformInfos) return
        const { modifiedAst, pathToNodeMap } =
          transformSecondarySketchLinesTagFirst({
            ast: kclManager.ast,
            selectionRanges,
            transformInfos,
            programMemory: kclManager.programMemory,
          })
        kclManager.updateAst(modifiedAst, true, {
          callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      }}
      disabled={!enableEqual}
      className="group"
      title="Equal Length"
    >
      <ActionIcon
        icon="equal"
        className="!p-0.5"
        bgClassName={sketchButtonClassnames.background}
        iconClassName={sketchButtonClassnames.icon}
        size="md"
      />
      Equal Length
    </button>
  )
}

export function setEqualLengthInfo({
  selectionRanges,
}: {
  selectionRanges: Selections
}) {
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

  const transforms = getTransformInfos(
    {
      ...selectionRanges,
      codeBasedSelections: selectionRanges.codeBasedSelections.slice(1),
    },
    kclManager.ast,
    'equalLength'
  )

  const enabled =
    !!secondaryVarDecs.length &&
    isAllTooltips &&
    isOthersLinkedToPrimary &&
    transforms.every(Boolean)

  return { enabled, transforms }
}

export function applyConstraintEqualLength({
  selectionRanges,
}: {
  selectionRanges: Selections
}): {
  modifiedAst: Program
  pathToNodeMap: PathToNodeMap
} {
  const { enabled, transforms } = setEqualLengthInfo({ selectionRanges })
  const { modifiedAst, pathToNodeMap } = transformSecondarySketchLinesTagFirst({
    ast: kclManager.ast,
    selectionRanges,
    transformInfos: transforms,
    programMemory: kclManager.programMemory,
  })
  return { modifiedAst, pathToNodeMap }
  // kclManager.updateAst(modifiedAst, true, {
  //   // callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
  // })
}
