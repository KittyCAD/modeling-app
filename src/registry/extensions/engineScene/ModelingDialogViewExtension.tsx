import { lazy, Suspense } from 'react'
import { useApp } from '@src/lib/boot'
import { isModelingDialogCommand } from '@src/lib/commandUtils'

const ModelingDialog = lazy(
  () => import('@src/components/ModelingDialog/ModelingDialog')
)

export function ModelingDialogViewExtension() {
  const { commands } = useApp()
  const state = commands.useState()
  if (
    state.matches('Closed') ||
    !isModelingDialogCommand(state.context.selectedCommand)
  )
    return null
  return (
    <div className="pointer-events-none absolute top-20 bottom-2 right-2 flex min-h-0 max-w-[calc(100%-1rem)] items-start">
      <Suspense fallback={null}>
        <ModelingDialog key={state.context.commandInvocationId} />
      </Suspense>
    </div>
  )
}
