import { toolTips } from '../../useStore'
import { Selections } from 'lib/selections'
import { Program, Value, VariableDeclarator } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
} from '../../lang/queryAst'
import { isSketchVariablesLinked } from '../../lang/std/sketchConstraints'
import {
  transformSecondarySketchLinesTagFirst,
  getTransformInfos,
  PathToNodeMap,
} from '../../lang/std/sketchcombos'
import { kclManager } from 'lang/KclSinglton'

export function equalAngleInfo({
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
    'equalAngle'
  )

  const enabled =
    !!secondaryVarDecs.length &&
    isAllTooltips &&
    isOthersLinkedToPrimary &&
    transforms.every(Boolean)
  return { enabled, transforms }
}

export function applyConstraintEqualAngle({
  selectionRanges,
}: {
  selectionRanges: Selections
}): {
  modifiedAst: Program
  pathToNodeMap: PathToNodeMap
} {
  const { transforms } = equalAngleInfo({ selectionRanges })
  const { modifiedAst, pathToNodeMap } = transformSecondarySketchLinesTagFirst({
    ast: kclManager.ast,
    selectionRanges,
    transformInfos: transforms,
    programMemory: kclManager.programMemory,
  })
  return { modifiedAst, pathToNodeMap }
}
