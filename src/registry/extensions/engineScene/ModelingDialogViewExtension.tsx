import { useApp } from '@src/lib/boot'
import { isModelingDialogCommand } from '@src/lib/commandUtils'
import { Suspense, lazy } from 'react'

const ModelingDialog = lazy(
  () => import('@src/components/ModelingDialog/ModelingDialog')
)

export function ModelingDialogViewExtension() {
  const { commands } = useApp()
  const commandBarState = commands.useState()
  const selectedCommand = commandBarState.context.selectedCommand
  const shouldUseModelingDialog =
    !commandBarState.matches('Closed') &&
    isModelingDialogCommand(selectedCommand)

  if (!shouldUseModelingDialog) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <ModelingDialog />
    </Suspense>
  )
}
