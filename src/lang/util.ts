import { Selections } from 'lib/selections'
import { PathToNode } from './wasm'
import { ArtifactGraph, filterArtifacts } from 'lang/std/artifactGraph'
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
        return selectionRanges.codeBasedSelections.some(
          (selection) =>
            Array.isArray(selection?.range) &&
            Array.isArray(artifact?.codeRef?.range) &&
            isOverlap(selection.range, artifact.codeRef.range)
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
