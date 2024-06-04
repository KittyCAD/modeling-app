import { toolTips } from '../../useStore'
import { Selection, Selections } from 'lib/selections'
import { PathToNode, Program, Value } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
} from '../../lang/queryAst'
import {
  PathToNodeMap,
  getRemoveConstraintsTransforms,
  transformAstSketchLines,
} from '../../lang/std/sketchcombos'
import { kclManager } from 'lib/singletons'

export function removeConstrainingValuesInfo({
  selectionRanges,
  pathToNodes,
}: {
  selectionRanges: Selections
  pathToNodes?: Array<PathToNode>
}) {
  const paths =
    pathToNodes ||
    selectionRanges.codeBasedSelections.map(({ range }) =>
      getNodePathFromSourceRange(kclManager.ast, range)
    )
  const nodes = paths.map(
    (pathToNode) => getNodeFromPath<Value>(kclManager.ast, pathToNode).node
  )
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

  try {
    const transforms = getRemoveConstraintsTransforms(
      updatedSelectionRanges,
      kclManager.ast,
      'removeConstrainingValues'
    )

    const enabled = isAllTooltips && transforms.every(Boolean)
    return { enabled, transforms, updatedSelectionRanges }
  } catch (e) {
    console.error(e)
    return { enabled: false, transforms: [], updatedSelectionRanges }
  }
}

export function applyRemoveConstrainingValues({
  selectionRanges,
  pathToNodes,
}: {
  selectionRanges: Selections
  pathToNodes?: Array<PathToNode>
}): {
  modifiedAst: Program
  pathToNodeMap: PathToNodeMap
} {
  const { transforms, updatedSelectionRanges } = removeConstrainingValuesInfo({
    selectionRanges,
    pathToNodes,
  })
  return transformAstSketchLines({
    ast: kclManager.ast,
    selectionRanges: updatedSelectionRanges,
    transformInfos: transforms,
    programMemory: kclManager.programMemory,
    referenceSegName: '',
  })
}
