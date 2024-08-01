import { toolTips } from 'lang/langHelpers'
import { Selection, Selections } from 'lib/selections'
import { CallExpression, PathToNode, Program } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getLastNodeFromPath,
  DynamicNode,
  castDynamicNode,
} from '../../lang/queryAst'
import {
  PathToNodeMap,
  getRemoveConstraintsTransforms,
  transformAstSketchLines,
  TransformInfo,
} from '../../lang/std/sketchcombos'
import { kclManager } from 'lib/singletons'
import { err } from 'lib/trap'
import { isArray } from 'lib/utils'

export function removeConstrainingValuesInfo({
  selectionRanges,
  pathToNodes,
}: {
  selectionRanges: Selections
  pathToNodes?: Array<PathToNode>
}):
  | {
      transforms: TransformInfo[]
      enabled: boolean
      updatedSelectionRanges: Selections
    }
  | Error {
  const paths =
    pathToNodes ||
    selectionRanges.codeBasedSelections.map(({ range }) =>
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

  const updatedSelectionRanges = pathToNodes
    ? {
        otherSelections: [],
        codeBasedSelections: nodes.map(
          (node): Selection => ({
            range: [node.start, node.end],
            type: 'default',
          })
        ),
      }
    : selectionRanges
  const isAllTooltips = nodes.every(
    (node) =>
      castDynamicNode<CallExpression>(node, 'CallExpression') &&
      toolTips.includes(node.callee.name as any)
  )

  const transforms = getRemoveConstraintsTransforms(
    updatedSelectionRanges,
    kclManager.ast,
    'removeConstrainingValues'
  )
  if (err(transforms)) return transforms

  const enabled = isAllTooltips && transforms.every(Boolean)
  return { enabled, transforms, updatedSelectionRanges }
}

export function applyRemoveConstrainingValues({
  selectionRanges,
  pathToNodes,
}: {
  selectionRanges: Selections
  pathToNodes?: Array<PathToNode>
}):
  | {
      modifiedAst: Program
      pathToNodeMap: PathToNodeMap
    }
  | Error {
  const constraint = removeConstrainingValuesInfo({
    selectionRanges,
    pathToNodes,
  })
  if (err(constraint)) return constraint
  const { transforms, updatedSelectionRanges } = constraint

  return transformAstSketchLines({
    ast: kclManager.ast,
    selectionRanges: updatedSelectionRanges,
    transformInfos: transforms,
    programMemory: kclManager.programMemory,
    referenceSegName: '',
  })
}
