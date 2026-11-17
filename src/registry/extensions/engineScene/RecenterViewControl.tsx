import { useSignals } from '@preact/signals-react/runtime'
import { ActionButton } from '@src/components/ActionButton'
import { useApp } from '@src/lib/boot'
import { reportRejection } from '@src/lib/trap'
import { viewportNavigationService } from '@src/registry/contracts/viewportNavigation'

export function RecenterViewControl() {
  useSignals()
  const { registry } = useApp()
  const navigation = registry.signal(viewportNavigationService).value
  if (!navigation?.isModelOutOfView.value) return null

  return (
    <ActionButton
      Element="button"
      type="button"
      tabIndex={0}
      className="h-8 whitespace-nowrap bg-2 shadow-sm focus-visible:ring-2 focus-visible:ring-primary"
      title="Fit the model in view"
      onClick={() => {
        navigation.recenter().catch(reportRejection)
      }}
    >
      Recenter
    </ActionButton>
  )
}
