import { toolTips } from '../../useStore'
import { Selections } from 'lib/selections'
import { PathToNode, Program, Value } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
} from '../../lang/queryAst'
import {
  PathToNodeMap,
  getRemoveConstraintsTransforms,
  removeSingleConstraint,
  transformAstSketchLines,
} from '../../lang/std/sketchcombos'
import { kclManager } from 'lib/singletons'

export function removeConstrainingValuesInfo({
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
  const isAllTooltips = nodes.every(
    (node) =>
      node?.type === 'CallExpression' &&
      toolTips.includes(node.callee.name as any)
  )

  try {
    const transforms = getRemoveConstraintsTransforms(
      selectionRanges,
      kclManager.ast,
      'removeConstrainingValues'
    )

    const enabled = isAllTooltips && transforms.every(Boolean)
    return { enabled, transforms }
  } catch (e) {
    console.error(e)
    return { enabled: false, transforms: [] }
  }
}

export function applyRemoveConstrainingValues({
  selectionRanges,
}: {
  selectionRanges: Selections
}): {
  modifiedAst: Program
  pathToNodeMap: PathToNodeMap
} {
  const { transforms } = removeConstrainingValuesInfo({ selectionRanges })
  return transformAstSketchLines({
    ast: kclManager.ast,
    selectionRanges,
    transformInfos: transforms,
    programMemory: kclManager.programMemory,
    referenceSegName: '',
  })
}

export function removeSingleConstraintInfo({
  pathToCallExp,
  arrayIndex,
  objectProperty,
}: {
  pathToCallExp: PathToNode
  arrayIndex?: number
  objectProperty?: string
}):
  | {
      modifiedAst: Program
      pathToNodeMap: PathToNodeMap
    }
  | false {
  // return false
  const transform = removeSingleConstraint({
    pathToCallExp,
    arrayIndex,
    objectProperty,
    ast: kclManager.ast,
  })
  if (!transform) return false
  return transformAstSketchLines({
    ast: kclManager.ast,
    selectionRanges: [pathToCallExp],
    transformInfos: [transform],
    programMemory: kclManager.programMemory,
    referenceSegName: '',
  })
}
