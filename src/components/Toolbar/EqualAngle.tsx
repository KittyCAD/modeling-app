import { toolTips } from 'lang/langHelpers'
import { Selections } from 'lib/selections'
import { Program, Expr, VariableDeclarator } from '../../lang/wasm'
import { getNodeFromPath } from '../../lang/queryAst'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import { isSketchVariablesLinked } from '../../lang/std/sketchConstraints'
import {
  transformSecondarySketchLinesTagFirst,
  getTransformInfos,
  PathToNodeMap,
} from '../../lang/std/sketchcombos'
import { kclManager } from 'lib/singletons'
import { err } from 'lib/trap'
import { TransformInfo } from 'lang/std/stdTypes'

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
  const paths = selectionRanges.graphSelections.map(({ codeRef }) =>
    getNodePathFromSourceRange(kclManager.ast, codeRef.range)
  )
  const _nodes = paths.map((pathToNode) => {
    const tmp = getNodeFromPath<Expr>(kclManager.ast, pathToNode)
    if (err(tmp)) return tmp
    return tmp.node
  })
  const _err1 = _nodes.find(err)
  if (err(_err1)) return _err1
  const nodes = _nodes as Expr[]

  const _varDecs = paths.map((pathToNode) => {
    const tmp = getNodeFromPath<VariableDeclarator>(
      kclManager.ast,
      pathToNode,
      'VariableDeclarator'
    )
    if (err(tmp)) return tmp
    return tmp.node
  })
  const _err2 = _varDecs.find(err)
  if (err(_err2)) return _err2
  const varDecs = _varDecs as VariableDeclarator[]

  const primaryLine = varDecs[0]
  const secondaryVarDecs = varDecs.slice(1)
  const isOthersLinkedToPrimary = secondaryVarDecs.every((secondary) =>
    isSketchVariablesLinked(secondary, primaryLine, kclManager.ast)
  )
  const isAllTooltips = nodes.every(
    (node) =>
      (node?.type === 'CallExpression' || node?.type === 'CallExpressionKw') &&
      toolTips.includes(node.callee.name as any)
  )

  const transforms = getTransformInfos(
    {
      ...selectionRanges,
      graphSelections: selectionRanges.graphSelections.slice(1),
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
