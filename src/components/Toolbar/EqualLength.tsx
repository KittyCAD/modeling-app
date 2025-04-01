import { toolTips } from 'lang/langHelpers'
import { TransformInfo } from 'lang/std/stdTypes'
import { Selections } from 'lib/selections'
import { kclManager } from 'lib/singletons'
import { err } from 'lib/trap'

import { Node } from '@rust/kcl-lib/bindings/Node'

import { getNodeFromPath } from '../../lang/queryAst'
import { isSketchVariablesLinked } from '../../lang/std/sketchConstraints'
import {
  PathToNodeMap,
  getTransformInfos,
  transformSecondarySketchLinesTagFirst,
} from '../../lang/std/sketchcombos'
import { Expr, Program, VariableDeclarator } from '../../lang/wasm'

export function setEqualLengthInfo({
  selectionRanges,
}: {
  selectionRanges: Selections
}):
  | {
      transforms: TransformInfo[]
      enabled: boolean
    }
  | Error {
  const _nodes = selectionRanges.graphSelections.map(({ codeRef }) => {
    const tmp = getNodeFromPath<Expr>(kclManager.ast, codeRef.pathToNode)
    if (err(tmp)) return tmp
    return tmp.node
  })
  const _err1 = _nodes.find(err)
  if (err(_err1)) return _err1
  const nodes = _nodes as Expr[]

  const _varDecs = selectionRanges.graphSelections.map(({ codeRef }) => {
    const tmp = getNodeFromPath<VariableDeclarator>(
      kclManager.ast,
      codeRef.pathToNode,
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
      toolTips.includes(node.callee.name.name as any)
  )

  const transforms = getTransformInfos(
    {
      ...selectionRanges,
      graphSelections: selectionRanges.graphSelections.slice(1),
    },
    kclManager.ast,
    'equalLength'
  )
  if (err(transforms)) return transforms

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
}):
  | {
      modifiedAst: Node<Program>
      pathToNodeMap: PathToNodeMap
    }
  | Error {
  const info = setEqualLengthInfo({ selectionRanges })
  if (err(info)) return info
  const { transforms } = info

  const transform = transformSecondarySketchLinesTagFirst({
    ast: kclManager.ast,
    selectionRanges,
    transformInfos: transforms,
    memVars: kclManager.variables,
  })
  if (err(transform)) return transform
  const { modifiedAst, pathToNodeMap } = transform

  return { modifiedAst, pathToNodeMap }
}
