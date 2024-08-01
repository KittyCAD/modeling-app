import { toolTips } from 'lang/langHelpers'
import { Selections } from 'lib/selections'
import { CallExpression, Program, ProgramMemory } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getLastNodeFromPath,
  DynamicNode,
  isNodeType,
} from '../../lang/queryAst'
import {
  PathToNodeMap,
  getTransformInfos,
  transformAstSketchLines,
  TransformInfo,
} from '../../lang/std/sketchcombos'
import { kclManager } from 'lib/singletons'
import { err } from 'lib/trap'
import { isArray } from 'lib/utils'

export function horzVertInfo(
  selectionRanges: Selections,
  horOrVert: 'vertical' | 'horizontal'
):
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

  const isAllTooltips = nodes.every(
    (node) =>
      isNodeType<CallExpression>(node, 'CallExpression') &&
      toolTips.includes(node.callee.name as any)
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
  ast: Program,
  programMemory: ProgramMemory
):
  | {
      modifiedAst: Program
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
    programMemory,
    referenceSegName: '',
  })
}
