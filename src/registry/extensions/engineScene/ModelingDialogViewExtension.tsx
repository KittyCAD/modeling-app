import { lazy, Suspense, useRef } from 'react'
import { useApp } from '@src/lib/boot'
import { isModelingDialogCommand } from '@src/lib/commandUtils'

const ModelingDialog = lazy(
  () => import('@src/components/ModelingDialog/ModelingDialog')
)

export function ModelingDialogViewExtension() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { commands } = useApp()
  const state = commands.useState()
  if (
    state.matches('Closed') ||
    !isModelingDialogCommand(state.context.selectedCommand)
  )
    return null
  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute top-20 bottom-2 inset-x-2 flex min-h-0 items-start justify-end"
    >
      <Suspense fallback={null}>
        <ModelingDialog
          key={state.context.commandInvocationId}
          containerRef={containerRef}
        />
      </Suspense>
    </div>
  )
}
