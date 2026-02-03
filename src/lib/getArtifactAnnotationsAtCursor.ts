import type { EditorState } from '@codemirror/state'
import {
  artifactDecorationsField,
  type ArtifactAnnotationData,
} from '@src/editor/plugins/artifacts'

/**
 * Returns any artifact annotation data intersecting the current primary cursor.
 */
export function getArtifactAnnotationsAtCursor(
  state: EditorState
): ArtifactAnnotationData[] {
  const pos = state.selection.main.head
  const decos = state.field(artifactDecorationsField, false)
  if (!decos) return []

  const results: ArtifactAnnotationData[] = []
  decos.between(pos, pos, (_from, _to, value) => {
    const attrs = (value.spec && value.spec.attributes) || null
    const json = attrs?.['data-artifact-json']
    if (json) {
      try {
        results.push(JSON.parse(json) as ArtifactAnnotationData)
      } catch {
        // ignore malformed JSON
      }
    }
  })
  return results
}
