import { Selections } from 'lib/selections'
import { Program, PathToNode } from './wasm'
import { getNodeFromPath } from './queryAst'
import {
  ArtifactMap,
  ArtifactMapCommand,
  SegmentArtifact,
  StartPathArtifact,
} from 'lang/std/artifactMap'
import { isOverlap } from 'lib/utils'
import { err } from 'lib/trap'

export function pathMapToSelections(
  ast: Program,
  prevSelections: Selections,
  pathToNodeMap: { [key: number]: PathToNode }
): Selections {
  const newSelections: Selections = {
    ...prevSelections,
    codeBasedSelections: [],
  }
  Object.entries(pathToNodeMap).forEach(([index, path]) => {
    const nodeMeta = getNodeFromPath<any>(ast, path)
    if (err(nodeMeta)) return
    const node = nodeMeta.node as any
    const type = prevSelections.codeBasedSelections[Number(index)].type
    if (node) {
      newSelections.codeBasedSelections.push({
        range: [node.start, node.end],
        type: type || 'default',
      })
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
  artifactMap: ArtifactMap,
  selectionRanges: Selections
): string | false {
  const overlappingEntries = Object.entries(artifactMap).filter(
    ([id, artifact]: [string, ArtifactMapCommand]) =>
      selectionRanges.codeBasedSelections.some(
        (selection) =>
          Array.isArray(selection?.range) &&
          Array.isArray(artifact?.range) &&
          isOverlap(selection.range, artifact.range) &&
          (artifact.type === 'startPath' || artifact.type === 'segment')
      )
  ) as [string, StartPathArtifact | SegmentArtifact][]
  const secondEntry = overlappingEntries?.[0]?.[1]
  const parentId = secondEntry?.type === 'segment' ? secondEntry.pathId : false
  let result = parentId
    ? parentId
    : overlappingEntries.find(
        ([, artifact]) => artifact.type === 'startPath'
      )?.[0] || false
  return result
}
