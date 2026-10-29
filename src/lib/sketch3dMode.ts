import { signal } from '@preact/signals-core'
import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { toUtf16 } from '@src/lang/errors'
import type { Selections } from '@src/machines/modelingSharedTypes'

/** Spatial sketches must never enter the plane-based 2D sketch machine. */
export function selectedSketch3d(
  objects: ApiObject[] | undefined,
  code: string,
  selections: Selections
): ApiObject | undefined {
  return objects?.find((object) => {
    if (
      object.kind.type !== 'Sketch3d' ||
      object.source.type !== 'Simple' ||
      object.source.range[2] !== 0
    )
      return false
    const source = object.source.range
    return selections.graphSelections.some(
      ({ artifact, codeRef }) =>
        (artifact?.type === 'sketchBlock' && artifact.sketchId === object.id) ||
        (codeRef?.range[2] === 0 &&
          toUtf16(source[0], code) <= codeRef.range[0] &&
          toUtf16(source[1], code) >= codeRef.range[1])
    )
  })
}

// Keep edit requests attached to their editor across file and project changes.
export const sketch3dEditRequest = signal<{
  editor: object
  label: string
} | null>(null)
