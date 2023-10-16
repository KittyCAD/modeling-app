import { Selections } from 'lib/selections'
import { Program, PathToNode } from './wasm'
import { getNodeFromPath } from './queryAst'
import { ArtifactMap } from './std/engineConnection'
import { isOverlap } from 'lib/utils'

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
    const node = getNodeFromPath(ast, path).node as any
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

export function isReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia &&
    // TODO/Note I (Kurt) think '(prefers-reduced-motion: reduce)' and '(prefers-reduced-motion)' are equivalent, but not 100% sure
    window.matchMedia('(prefers-reduced-motion)').matches
  )
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
  return overlapingEntries.length && overlapingEntries[0][1].parentId
    ? overlapingEntries[0][1].parentId
    : overlapingEntries.find(
        ([, artifact]) => artifact.commandType === 'start_path'
      )?.[0] || false
}
