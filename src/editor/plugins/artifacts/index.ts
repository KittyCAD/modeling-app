import type { Extension, Range } from '@codemirror/state'
import { StateEffect, StateField, Annotation, Facet } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

import type { Artifact, CodeRef } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph } from '@src/lang/wasm'
import {
  getArtifactFromRange,
  getArtifactsAtCursor,
  getCodeRefsByArtifactId,
} from '@src/lang/std/artifactGraph'

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

/** A freestanding Facet that holds an artifact array */
export const graphSelectionsFacet = Facet.define<Artifact[]>({
  // combine(input) {
  //   return Array.from(new Set(input))
  // },
  // /** Artifact graph selections match when all of constituent artifacts' IDs match */
  // compare(a, b) {
  //   const flatA = a.flat()
  //   const flatB = b.flat()
  //   return (
  //     flatA.length === flatB.length &&
  //     flatA.every((artifactA) =>
  //       flatB.findIndex((artifactB) => artifactA.id === artifactB.id)
  //     )
  //   )
  // },
})

/** A CodeMirror extension that computes an artifact array based on the current selection and artifactGraph */
const deriveGraphSelections = graphSelectionsFacet.compute(
  ['selection', artifactGraphField],
  (state) => {
    const graph = state.field(artifactGraphField)
    const selection = state.selection
    let graphSelections: Artifact[] = []

    for (const range of selection.ranges) {
      const artifacts = getArtifactsAtCursor(range.head, graph)
      if (artifacts?.length) {
        graphSelections = graphSelections.concat(artifacts.flat())
      }
    }

    console.log('deriving some graph selections!', {
      selection,
      graph,
      graphSelections,
    })
    return graphSelections
  }
)

const graphSelectionsLogger = EditorView.updateListener.of((update) => {
  if (!update.selectionSet) {
    console.log('No selection change!')
  } else {
    console.log(
      `selection updated, let's check out the graphSelections`,
      update.state.facet(graphSelectionsFacet)
    )
  }
})

/** Decorations field that stores ranges annotated with artifact metadata */
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
  return [
    artifactGraphField,
    artifactDecorationsField,
    deriveGraphSelections,
    graphSelectionsLogger,
  ]
}
