import { Selections, Selections__old } from 'lib/selections'
import { Program, PathToNode } from './wasm'
import { getNodeFromPath } from './queryAst'
import { ArtifactGraph, filterArtifacts } from 'lang/std/artifactGraph'
import { isOverlap } from 'lib/utils'
import { err } from 'lib/trap'

export function pathMapToSelections(
  ast: Program,
  prevSelections: Selections__old,
  pathToNodeMap: { [key: number]: PathToNode }
): Selections__old {
  const newSelections: Selections__old = {
    ...prevSelections,
    codeBasedSelections: [],
  }
  Object.entries(pathToNodeMap).forEach(([index, path]) => {
    const nodeMeta = getNodeFromPath<any>(ast, path)
    if (err(nodeMeta)) return
    const node = nodeMeta.node as any
    const selection = prevSelections.codeBasedSelections[Number(index)]
    if (node) {
      if (
        selection.type === 'base-edgeCut' ||
        selection.type === 'adjacent-edgeCut' ||
        selection.type === 'opposite-edgeCut'
      ) {
        newSelections.codeBasedSelections.push({
          range: [node.start, node.end],
          type: selection.type,
          secondaryRange: selection.secondaryRange,
        })
      } else {
        newSelections.codeBasedSelections.push({
          range: [node.start, node.end],
          type: selection.type,
        })
      }
    }
  })
  return newSelections
}

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
