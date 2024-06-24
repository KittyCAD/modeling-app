import { Selections } from 'lib/selections'
import { Program, PathToNode } from './wasm'
import { getNodeFromPath } from './queryAst'
import { ArtifactMap } from './std/engineConnection'
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
  const updatedPathToNode = JSON.parse(JSON.stringify(oldPath))
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
  const overlapingEntries: [string, ArtifactMap[string]][] = Object.entries(
    artifactMap
  ).filter(([id, artifact]: [string, ArtifactMap[string]]) =>
    selectionRanges.codeBasedSelections.some(
      (selection) =>
        Array.isArray(selection?.range) &&
        Array.isArray(artifact?.range) &&
        isOverlap(selection.range, artifact.range) &&
        (artifact.commandType === 'start_path' ||
          artifact.commandType === 'extend_path' ||
          artifact.commandType === 'close_path')
    )
  )
  let result =
    overlapingEntries.length && overlapingEntries[0][1].parentId
      ? overlapingEntries[0][1].parentId
      : overlapingEntries.find(
          ([, artifact]) => artifact.commandType === 'start_path'
        )?.[0] || false
  return result
}
