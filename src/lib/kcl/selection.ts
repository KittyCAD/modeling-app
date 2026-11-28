import type { EnginePrimitiveSelection } from '@src/machines/modelingSharedTypes'
import { computed, type ReadonlySignal } from '@preact/signals-core'
import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import type { SceneSelection } from '@src/lib/kcl/scene/selection'
import type { SketchSolveSelectionId } from '@src/machines/sketchSolve/sketchSolveSelection'

/** References retain their domain and owner; generic consumers need no interaction-mode dispatch. */
export type ActiveSelectionItem =
  | { kind: 'model'; value: SceneSelection }
  | {
      kind: 'engine-primitive'
      model: SceneSelection['model']
      selection: EnginePrimitiveSelection
    }
  | {
      kind: 'sketch'
      sessionId: symbol
      sketchId: number
      id: SketchSolveSelectionId
    }

/** Interactions expose the same read/clear capability without moving state out of its owner. */
export interface SelectionSource {
  readonly items: ReadonlySignal<readonly ActiveSelectionItem[]>
  readonly canClear: ReadonlySignal<boolean>
  clear: () => void
}

/** The active owner supplies displayed selection; ordinary view selection remains available separately. */
export function createActiveSelection(
  getContext: () => Pick<ModelingViewContext, 'session' | 'interactions'>,
  ownedSelection?: () => SelectionSource | undefined
): SelectionSource {
  const source = computed(
    () =>
      ownedSelection?.() ??
      getContext().interactions.active.value?.selection?.value
  )
  const items = computed<readonly ActiveSelectionItem[]>(() => {
    if (source.value) return source.value.items.value
    return (
      getContext().session.resource.value?.selection.displayed.value.map(
        (value) => ({ kind: 'model' as const, value })
      ) ?? []
    )
  })
  const canClear = computed(() =>
    source.value
      ? source.value.canClear.value
      : !!items.value.length &&
        !!getContext().session.resource.value?.selection.pickingEnabled.value
  )
  return {
    items,
    canClear,
    clear: () => {
      if (!canClear.peek()) return
      const owner = source.peek()
      if (owner) owner.clear()
      else getContext().session.resource.peek()?.selection.clear()
    },
  }
}
