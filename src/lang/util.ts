import { Selections } from 'lib/selections'
import {
  PathToNode,
  CallExpression,
  Literal,
  ArrayExpression,
  BinaryExpression,
  ArtifactGraph,
  CallExpressionKw,
  Expr,
  LiteralValue,
  NumericSuffix,
} from './wasm'
import { filterArtifacts, getFaceCodeRef } from 'lang/std/artifactGraph'
import { isArray, isOverlap } from 'lib/utils'

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
      types: ['segment', 'path', 'plane', 'cap', 'wall'],
      predicate: (artifact) => {
        const codeRefRange = getFaceCodeRef(artifact)?.range
        return selectionRanges.graphSelections.some(
          (selection) =>
            isArray(selection?.codeRef?.range) &&
            isArray(codeRefRange) &&
            isOverlap(selection?.codeRef?.range, codeRefRange)
        )
      },
    },
    artifactGraph
  )
  const firstEntry = [...overlappingEntries.values()]?.[0]
  const parentId =
    firstEntry?.type === 'segment'
      ? firstEntry.pathId
      : (firstEntry?.type === 'plane' ||
          firstEntry?.type === 'cap' ||
          firstEntry?.type === 'wall') &&
        firstEntry.pathIds.length
      ? firstEntry.pathIds[0]
      : false

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

/**
Search the keyword arguments from a call for an argument with this label.
*/
export function findKwArg(
  label: string,
  call: CallExpressionKw
): Expr | undefined {
  return call?.arguments?.find((arg) => {
    return arg.label.name === label
  })?.arg
}

/**
Search the keyword arguments from a call for an argument with this label,
returns the index of the argument as well.
*/
export function findKwArgWithIndex(
  label: string,
  call: CallExpressionKw
): { expr: Expr; argIndex: number } | undefined {
  const index = call.arguments.findIndex((arg) => {
    return arg.label.name === label
  })
  return index >= 0
    ? { expr: call.arguments[index].arg, argIndex: index }
    : undefined
}

/**
Search the keyword arguments from a call for an argument with one of these labels.
*/
export function findKwArgAny(
  labels: string[],
  call: CallExpressionKw
): Expr | undefined {
  return call.arguments.find((arg) => {
    return labels.includes(arg.label.name)
  })?.arg
}

/**
Search the keyword arguments from a call for an argument with one of these labels.
*/
export function findKwArgAnyIndex(
  labels: string[],
  call: CallExpressionKw
): number | undefined {
  return call.arguments.findIndex((arg) => {
    return labels.includes(arg.label.name)
  })
}

export function isAbsolute(call: CallExpressionKw): boolean {
  return findKwArgAny(['endAbsolute'], call) !== undefined
}

export function isLiteralValueNumber(
  e: LiteralValue
): e is { value: number; suffix: NumericSuffix } {
  return (
    typeof e === 'object' &&
    'value' in e &&
    typeof e.value === 'number' &&
    'suffix' in e &&
    typeof e.suffix === 'string'
  )
}
