import { toolTips } from 'lang/langHelpers'
import { Selection, Selections } from 'lib/selections'
import { PathToNode, Program, Expr } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
} from '../../lang/queryAst'
import {
  PathToNodeMap,
  getRemoveConstraintsTransforms,
  transformAstSketchLines,
} from '../../lang/std/sketchcombos'
import { TransformInfo } from 'lang/std/stdTypes'
import { kclManager } from 'lib/singletons'
import { err } from 'lib/trap'

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
    const tmp = getNodeFromPath<Expr>(kclManager.ast, pathToNode)
    if (err(tmp)) return tmp
    return tmp.node
  })
  const _err1 = _nodes.find(err)
  if (err(_err1)) return _err1
  const nodes = _nodes as Expr[]

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
      node?.type === 'CallExpression' &&
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
