import { toolTips } from 'lang/langHelpers'
import { Selections } from 'lib/selections'
import { Program, Expr, VariableMap } from '../../lang/wasm'
import { getNodeFromPath } from '../../lang/queryAst'
import {
  PathToNodeMap,
  getTransformInfos,
  transformAstSketchLines,
} from '../../lang/std/sketchcombos'
import { TransformInfo } from 'lang/std/stdTypes'
import { kclManager } from 'lib/singletons'
import { err } from 'lib/trap'
import { Node } from '@rust/kcl-lib/bindings/Node'

export function horzVertInfo(
  selectionRanges: Selections,
  horOrVert: 'vertical' | 'horizontal'
):
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

  const isAllTooltips = nodes.every(
    (node) =>
      (node?.type === 'CallExpression' || node?.type === 'CallExpressionKw') &&
      toolTips.includes(node.callee.name.name as any)
  )

  const theTransforms = getTransformInfos(
    selectionRanges,
    kclManager.ast,
    horOrVert
  )
  if (err(theTransforms)) return theTransforms

  const _enableHorz = isAllTooltips && theTransforms.every(Boolean)
  return { enabled: _enableHorz, transforms: theTransforms }
}

export function applyConstraintHorzVert(
  selectionRanges: Selections,
  horOrVert: 'vertical' | 'horizontal',
  ast: Node<Program>,
  memVars: VariableMap
):
  | {
      modifiedAst: Node<Program>
      pathToNodeMap: PathToNodeMap
    }
  | Error {
  const info = horzVertInfo(selectionRanges, horOrVert)
  if (err(info)) return info
  const transformInfos = info.transforms

  return transformAstSketchLines({
    ast,
    selectionRanges,
    transformInfos,
    memVars,
    referenceSegName: '',
  })
}
