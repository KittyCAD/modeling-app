import { Selections } from 'lib/selections'
import {
  PathToNode,
  CallExpression,
  Literal,
  ArrayExpression,
  BinaryExpression,
  ArtifactGraph,
  LiteralValue,
  NumericSuffix,
} from './wasm'
import { filterArtifacts } from 'lang/std/artifactGraph'
import { isOverlap } from 'lib/utils'

export function updatePathToNodeFromMap(
  oldPath: PathToNode,
  pathToNodeMap: { [key: number]: PathToNode }
): PathToNode {
  const updatedPathToNode = structuredClone(oldPath)
  let max = 0
  Object.values(pathToNodeMap).forEach((path) => {
    const index = Number(path[1][0])
    if (index > max) {
      max = index
    }
  })
  updatedPathToNode[1][0] = max
  return updatedPathToNode
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

export function isLiteralValueNotStringAndBoolean(
  e: any
): e is { value: number; suffix: NumericSuffix } {
  return e && 'value' in e && 'suffix' in e
}
