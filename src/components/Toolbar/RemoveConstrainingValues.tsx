import type { Node } from '@rust/kcl-lib/bindings/Node'

import { toolTips } from '@src/lang/langHelpers'
import { getNodeFromPath } from '@src/lang/queryAst'
import { codeRefFromRange } from '@src/lang/std/artifactGraph'
import type { PathToNodeMap } from '@src/lang/std/sketchcombos'
import {
  getRemoveConstraintsTransforms,
  transformAstSketchLines,
} from '@src/lang/std/sketchcombos'
import type { TransformInfo } from '@src/lang/std/stdTypes'
import { topLevelRange } from '@src/lang/util'
import type { Expr, PathToNode, Program } from '@src/lang/wasm'
import type { Selection, Selections } from '@src/lib/selections'
import { kclManager } from '@src/lib/singletons'
import { err } from '@src/lib/trap'

export function removeConstrainingValuesInfo(pathToNodes: Array<PathToNode>):
  | {
      transforms: TransformInfo[]
      enabled: boolean
      updatedSelectionRanges: Selections
    }
  | Error {
  const _nodes = pathToNodes.map((pathToNode) => {
    const tmp = getNodeFromPath<Expr>(kclManager.ast, pathToNode)
    if (tmp instanceof Error) return tmp
    return tmp.node
  })
  const _err1 = _nodes.find(err)
  if (err(_err1)) return _err1
  const nodes = _nodes as Expr[]

  const updatedSelectionRanges = {
    otherSelections: [],
    graphSelections: nodes.map(
      (node): Selection => ({
        codeRef: codeRefFromRange(
          topLevelRange(node.start, node.end),
          kclManager.ast
        ),
      })
    ),
  }
  const isAllTooltips = nodes.every(
    (node) =>
      node?.type === 'CallExpressionKw' &&
      toolTips.includes(node.callee.name.name as any)
  )

  const transforms = getRemoveConstraintsTransforms(
    updatedSelectionRanges,
    kclManager.ast
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
      modifiedAst: Node<Program>
      pathToNodeMap: PathToNodeMap
    }
  | Error {
  pathToNodes =
    pathToNodes ||
    selectionRanges.graphSelections.map(({ codeRef }) => {
      return codeRef.pathToNode
    })
  const constraint = removeConstrainingValuesInfo(pathToNodes)
  if (err(constraint)) return constraint
  const { transforms, updatedSelectionRanges } = constraint

  return transformAstSketchLines({
    ast: kclManager.ast,
    selectionRanges: updatedSelectionRanges,
    transformInfos: transforms,
    memVars: kclManager.variables,
    referenceSegName: '',
  })
}
