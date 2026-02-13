import type { Extension, Range } from '@codemirror/state'
import { StateEffect, StateField, Annotation } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

import type { Artifact, CodeRef } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph } from '@src/lang/wasm'
import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'

const artifactAnnotationsAnnotation = Annotation.define<boolean>()
/** Transaction annotation to identify artifact annotation updates */
export const artifactAnnotationsEvent = artifactAnnotationsAnnotation.of(true)

/** Effect used to replace the current artifact graph in state */
export const setArtifactGraphEffect = StateEffect.define<ArtifactGraph | null>()

/** Public shape stored on each decoration so we can inspect it later */
export interface ArtifactAnnotationData {
  id: string
  type: Artifact['type']
  codeRef: CodeRef
}

/** StateField to hold the current artifact graph reference on the EditorState */
export const artifactGraphField = StateField.define<ArtifactGraph>({
  create() {
    return new Map()
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setArtifactGraphEffect)) {
        return e.value ?? new Map()
      }
    }
    return value
  },
})

/**
 * Decorations field that stores ranges annotated with artifact metadata
 *
 * Removed for now as a fix to https://github.com/KittyCAD/modeling-app/issues/9366
 */
export const artifactDecorationsField = StateField.define<
  ReturnType<typeof Decoration.set>
>({
  create() {
    return Decoration.none
  },
  update(decorations, tr) {
    // Recompute all decorations when the artifact graph effect is applied
    for (const e of tr.effects) {
      if (e.is(setArtifactGraphEffect)) {
        const graph = e.value ?? new Map()
        return buildArtifactDecorations(graph, tr.state)
      }
    }
    // Map existing decorations through document changes
    if (tr.docChanged) {
      return decorations.map(tr.changes)
    }
    return decorations
  },
  provide: (f) => EditorView.decorations.from(f),
})

/**
 * Given an ArtifactGraph, apply decorations to the corresponding code ranges with
 * each artifact's metadata.
 */
function buildArtifactDecorations(
  graph: ArtifactGraph,
  state: EditorView['state']
) {
  const widgets: Range<Decoration>[] = []
  const docLen = state.doc.length

  for (const [id, artifact] of graph.entries()) {
    const refs = getCodeRefsByArtifactId(id, graph)
    if (!refs) continue
    for (const codeRef of refs) {
      const from = Math.max(0, Math.min(codeRef.range[0], docLen))
      const to = Math.max(0, Math.min(codeRef.range[1], docLen))
      if (to <= from) continue
      const data: ArtifactAnnotationData = { id, type: artifact.type, codeRef }
      widgets.push(
        Decoration.mark({
          class: 'cm-artifact-range',
          attributes: {
            'data-artifact-id': id,
            'data-artifact-type': artifact.type,
            'data-artifact-json': JSON.stringify(data),
          },
          inclusive: false,
        }).range(from, to)
      )
    }
  }

  return Decoration.set(widgets, true)
}

export function artifactAnnotationsExtension(): Extension {
  return [artifactGraphField]
}
