import { signal, type ReadonlySignal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import type {
  EditorTabIndicator,
  EditorViewInstance,
} from '@src/lib/editors/registry/contract'
import type { KclViewExecutionState } from '@src/lib/kcl/modeling/viewExecution'

/** A tab observes its existing Modeling result; displaying an indicator never acquires execution resources. */
export function createStaleModelIndicator(
  isModeling: (instance: EditorViewInstance) => boolean
) {
  const results = signal<
    ReadonlyMap<symbol, ReadonlySignal<KclViewExecutionState>>
  >(new Map())
  const indicator: EditorTabIndicator = {
    id: 'kcl.stale',
    component: function StaleIndicator({ instance }) {
      useSignals()
      const result = results.value.get(instance.id)
      if (!result || !isModeling(instance)) return null
      const output = result.value
      if (!output.result || !output.stale) return null
      return (
        <span
          title="Model is out of date."
          className="shrink-0 rounded border b-4 px-1 text-xs font-normal text-2"
        >
          Stale
        </span>
      )
    },
  }
  return {
    indicator,
    track: (
      instance: EditorViewInstance,
      state: ReadonlySignal<KclViewExecutionState>
    ) => {
      results.value = new Map(results.peek()).set(instance.id, state)
      return () => {
        if (results.peek().get(instance.id) !== state) return
        const remaining = new Map(results.peek())
        remaining.delete(instance.id)
        results.value = remaining
      }
    },
  }
}
