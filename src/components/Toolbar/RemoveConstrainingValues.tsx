import { toolTips } from 'lang/langHelpers'
import { codeRefFromRange } from 'lang/std/artifactGraph'
import { TransformInfo } from 'lang/std/stdTypes'
import { Selection, Selections } from 'lib/selections'
import { kclManager } from 'lib/singletons'
import { err } from 'lib/trap'

import { Node } from '@rust/kcl-lib/bindings/Node'

import { getNodeFromPath } from '../../lang/queryAst'
import {
  PathToNodeMap,
  getRemoveConstraintsTransforms,
  transformAstSketchLines,
} from '../../lang/std/sketchcombos'
import { Expr, PathToNode, Program, topLevelRange } from '../../lang/wasm'

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
  const _nodes = selectionRanges.graphSelections.map(({ codeRef }) => {
    const tmp = getNodeFromPath<Expr>(kclManager.ast, codeRef.pathToNode)
    if (tmp instanceof Error) return tmp
    return tmp.node
  })
  const _err1 = _nodes.find(err)
  if (err(_err1)) return _err1
  const nodes = _nodes as Expr[]

  const updatedSelectionRanges = pathToNodes
    ? {
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
    : selectionRanges
  const isAllTooltips = nodes.every(
    (node) =>
      (node?.type === 'CallExpression' || node?.type === 'CallExpressionKw') &&
      toolTips.includes(node.callee.name.name as any)
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
      modifiedAst: Node<Program>
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
    memVars: kclManager.variables,
    referenceSegName: '',
  })
}
