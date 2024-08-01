import { toolTips } from 'lang/langHelpers'
import { Selections } from 'lib/selections'
import { CallExpression, Program, VariableDeclarator } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getLastNodeFromPath,
  DynamicNode,
  isNodeType,
  expectNodeOnPath,
} from '../../lang/queryAst'
import { isSketchVariablesLinked } from '../../lang/std/sketchConstraints'
import {
  transformSecondarySketchLinesTagFirst,
  getTransformInfos,
  PathToNodeMap,
  TransformInfo,
} from '../../lang/std/sketchcombos'
import { kclManager } from 'lib/singletons'
import { err } from 'lib/trap'
import { isArray } from 'lib/utils'

export function equalAngleInfo({
  selectionRanges,
}: {
  selectionRanges: Selections
}):
  | {
      transforms: TransformInfo[]
      enabled: boolean
    }
  | Error {
  const paths = selectionRanges.codeBasedSelections.map(({ range }) =>
    getNodePathFromSourceRange(kclManager.ast, range)
  )
  const _nodes = paths.map((pathToNode) => {
    const tmp = getLastNodeFromPath(kclManager.ast, pathToNode)
    if (err(tmp)) return tmp
    if (isArray(tmp.node)) {
      return new Error('Expected value node, but found array')
    }
    return tmp.node
  })
  const nodes: DynamicNode[] = []
  for (const node of _nodes) {
    if (err(node)) return node
    nodes.push(node)
  }

  const _varDecs = paths.map((pathToNode) => {
    const tmp = expectNodeOnPath<VariableDeclarator>(
      kclManager.ast,
      pathToNode,
      'VariableDeclarator'
    )
    if (err(tmp)) return tmp
    return tmp
  })
  const varDecs: VariableDeclarator[] = []
  for (const varDec of _varDecs) {
    if (err(varDec)) return varDec
    varDecs.push(varDec)
  }

  const primaryLine = varDecs[0]
  const secondaryVarDecs = varDecs.slice(1)
  const isOthersLinkedToPrimary = secondaryVarDecs.every((secondary) =>
    isSketchVariablesLinked(secondary, primaryLine, kclManager.ast)
  )
  const isAllTooltips = nodes.every(
    (node) =>
      isNodeType<CallExpression>(node, 'CallExpression') &&
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
  if (err(transforms)) return transforms

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
}):
  | {
      modifiedAst: Program
      pathToNodeMap: PathToNodeMap
    }
  | Error {
  const info = equalAngleInfo({ selectionRanges })
  if (err(info)) return info
  const { transforms } = info

  const transform = transformSecondarySketchLinesTagFirst({
    ast: kclManager.ast,
    selectionRanges,
    transformInfos: transforms,
    programMemory: kclManager.programMemory,
  })
  if (err(transform)) return transform
  const { modifiedAst, pathToNodeMap } = transform

  return { modifiedAst, pathToNodeMap }
}
