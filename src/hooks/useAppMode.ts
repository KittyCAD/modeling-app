import { Selections } from 'useStore'
import { ArtifactMap, EngineCommandManager } from 'lang/std/engineConnection'
import { isOverlap } from 'lib/utils'

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
