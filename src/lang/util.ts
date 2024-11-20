import { Selections } from 'lib/selections'
import {
  PathToNode,
  CallExpression,
  Literal,
  ArrayExpression,
  BinaryExpression,
} from './wasm'
import { ArtifactGraph, filterArtifacts } from 'lang/std/artifactGraph'
import { isOverlap } from 'lib/utils'

/**
 * Updates pathToNode body indices to account for the insertion of an expression
 * PathToNode expression is after the insertion index, that the body index is incremented
 * Negative insertion index means no insertion
 */
export function updatePathToNodePostExprInjection(
  pathToNode: PathToNode,
  exprInsertIndex: number
): PathToNode {
  if (exprInsertIndex < 0) return pathToNode
  const bodyIndex = Number(pathToNode[1][0])
  if (bodyIndex < exprInsertIndex) return pathToNode
  const clone = structuredClone(pathToNode)
  clone[1][0] = bodyIndex + 1
  return clone
}

export function updateSketchDetailsNodePaths({
  sketchEntryNodePath,
  sketchNodePaths,
  planeNodePath,
  exprInsertIndex,
}: {
  sketchEntryNodePath: PathToNode
  sketchNodePaths: Array<PathToNode>
  planeNodePath: PathToNode
  exprInsertIndex: number
}) {
  return {
    updatedSketchEntryNodePath: updatePathToNodePostExprInjection(
      sketchEntryNodePath,
      exprInsertIndex
    ),
    updatedSketchNodePaths: sketchNodePaths.map((path) =>
      updatePathToNodePostExprInjection(path, exprInsertIndex)
    ),
    updatedPlaneNodePath: updatePathToNodePostExprInjection(
      planeNodePath,
      exprInsertIndex
    ),
  }
}

export function isCursorInSketchCommandRange(
  artifactGraph: ArtifactGraph,
  selectionRanges: Selections
): string | false {
  const overlappingEntries = filterArtifacts(
    {
      types: ['segment', 'path'],
      predicate: (artifact) => {
        return selectionRanges.graphSelections.some(
          (selection) =>
            Array.isArray(selection?.codeRef?.range) &&
            Array.isArray(artifact?.codeRef?.range) &&
            isOverlap(selection?.codeRef?.range, artifact.codeRef.range)
        )
      },
    },
    artifactGraph
  )
  const firstEntry = [...overlappingEntries.values()]?.[0]
  const parentId = firstEntry?.type === 'segment' ? firstEntry.pathId : false

  return parentId
    ? parentId
    : [...overlappingEntries].find(
        ([, artifact]) => artifact.type === 'path'
      )?.[0] || false
}

export function isCallExpression(e: any): e is CallExpression {
  return e && e.type === 'CallExpression'
}

export function isArrayExpression(e: any): e is ArrayExpression {
  return e && e.type === 'ArrayExpression'
}

export function isLiteral(e: any): e is Literal {
  return e && e.type === 'Literal'
}

export function isBinaryExpression(e: any): e is BinaryExpression {
  return e && e.type === 'BinaryExpression'
}
