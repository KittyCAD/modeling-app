import { useSignals } from '@preact/signals-react/runtime'
import { useLocation, useNavigate } from 'react-router-dom'
import { waitFor } from 'xstate'

import { ActionButton } from '@src/components/ActionButton'
import { useApp, useSingletons } from '@src/lib/boot'
import { PATHS } from '@src/lib/paths'
import type { Setting } from '@src/lib/settings/Setting'
import { reportRejection } from '@src/lib/trap'

/** Offers a restart while a setting's saved value is not yet in effect. */
export function SettingRestartButton({
  setting,
}: {
  setting: Setting<unknown>
}) {
  useSignals()
  const { settings } = useApp()
  const { kclManager } = useSingletons()
  const navigate = useNavigate()
  const location = useLocation()
  if (
    !setting.restartRequired?.(
      setting.currentSignal.value,
      kclManager.engineCommandManager
    )
  ) {
    return null
  }

  return (
    <ActionButton
      Element="button"
      className="mt-2"
      onClick={() => {
        // Reloading before the change is saved would start with the old value.
        waitFor(settings.actor, (state) => state.matches('idle'))
          // The settings dialog is a route, so leave it or the reload reopens it.
          .then(() => navigate(location.pathname.replace(PATHS.SETTINGS, '')))
          .then(() => window.location.reload())
          .catch(reportRejection)
      }}
      iconStart={{ icon: 'refresh', size: 'sm', className: 'p-1' }}
    >
      Restart to apply
    </ActionButton>
  )
}
