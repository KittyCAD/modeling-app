import { useSignals } from '@preact/signals-react/runtime'
import { waitFor } from 'xstate'

import { ActionButton } from '@src/components/ActionButton'
import { useApp, useSingletons } from '@src/lib/boot'
import { PATHS } from '@src/lib/paths'
import type { Setting } from '@src/lib/settings/Setting'
import { reportRejection } from '@src/lib/trap'
import { routerService } from '@src/registry/contracts/router'

/** Offers a restart while a setting's saved value is not yet in effect. */
export function SettingRestartButton({
  setting,
}: {
  setting: Setting<unknown>
}) {
  useSignals()
  const { settings, registry } = useApp()
  const { kclManager } = useSingletons()
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
        const router = registry.get(routerService)
        // Reloading before the change is saved would start with the old value.
        waitFor(settings.actor, (state) => state.matches('idle'))
          // The settings dialog is a route, so leave it or the reload reopens it.
          .then(() =>
            router.navigate(
              router.getLocation().pathname.replace(PATHS.SETTINGS, '')
            )
          )
          .then(() => window.location.reload())
          .catch(reportRejection)
      }}
      iconStart={{ icon: 'refresh', size: 'sm', className: 'p-1' }}
    >
      Restart to apply
    </ActionButton>
  )
}
