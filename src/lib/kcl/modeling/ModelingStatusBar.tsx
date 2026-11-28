import { useSignals } from '@preact/signals-react/runtime'
import { StatusBarFrame } from '@src/components/StatusBar/StatusBar'
import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import { Suspense } from 'react'

/** A status contribution always receives the view whose footer contains it. */
export function ModelingStatusBar({
  context,
}: {
  context: ModelingViewContext
}) {
  useSignals()
  const items = context.statusItems.value.toSorted((a, b) => a.order - b.order)
  return (
    <StatusBarFrame
      label="Modeling view status"
      className="flex-wrap b-3 bg-2 text-2"
    >
      {(['start', 'end'] as const).map((side) => (
        <div
          key={side}
          className="flex min-w-0 flex-wrap items-stretch"
          data-status-side={side}
        >
          {items
            .filter((item) => item.side === side)
            .map(({ id, Component }) => (
              <Suspense key={id} fallback={null}>
                <Component context={context} />
              </Suspense>
            ))}
        </div>
      ))}
    </StatusBarFrame>
  )
}
