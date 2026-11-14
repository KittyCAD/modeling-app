import { sketchIntent } from '@src/lib/kcl/sketch/selection'
import type { DefaultPlaneStr } from '@src/lib/planes'
import type { ReadonlySignal } from '@preact/signals-core'
import type { SketchToolDefinition } from '@src/lib/kcl/sketch/contract'
import type { ModelingInteractionDefinition } from '@src/lib/kcl/interactions'
import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { sketchButtonPresentation } from '@src/lib/sketchButtonPresentation'

function selectionPresentation(context: ModelingViewContext) {
  const scene = context.session.resource.value
  const selection = scene?.selection.selected.value ?? []
  const defaults = scene?.runtime.state.value.defaultPlanes
  const selections: Selections = {
    graphSelections: selection.map((value) => ({ entityRef: value.reference })),
    otherSelections: [],
  }
  for (const { reference } of selection)
    if (reference.type === 'plane' && defaults) {
      const name = Object.entries(defaults).find(
        ([, id]) => id === reference.plane_id
      )?.[0]
      const names: Record<string, DefaultPlaneStr> = {
        xy: 'XY',
        xz: 'XZ',
        yz: 'YZ',
        negXy: '-XY',
        negXz: '-XZ',
        negYz: '-YZ',
      }
      if (name && names[name])
        selections.otherSelections.push({
          id: reference.plane_id,
          name: names[name],
        })
    }
  return sketchButtonPresentation(
    selection.some(({ reference }) => sketchIntent(reference) === 'edit'),
    selections
  )
}

/** One sketch action adapts to selection, both before opening and while waiting for a target. */
export function createSketchInteraction(
  tools: ReadonlySignal<readonly SketchToolDefinition[]>
): ModelingInteractionDefinition {
  return {
    id: 'kcl.sketch',
    entries: [
      {
        id: 'kcl.sketch.start',
        name: 'Start Sketch',
        groupId: 'kcl.sketch.entry',
        icon: 'sketch',
        presentation: selectionPresentation,
        createSession: async (context, signal) =>
          (await import('@src/lib/kcl/sketch/session')).createSketchSession(
            context,
            signal,
            tools
          ),
      },
    ],
  }
}
