import { PATHS } from '@src/lib/paths'
import type { RouterRegistryService } from '@src/registry/contracts/router'

/** Restart after saving, leaving the settings dialog closed on reload. */
export async function restartApp(
  router: Pick<RouterRegistryService, 'getLocation' | 'navigate'>,
  signal?: AbortSignal
) {
  const { pathname } = router.getLocation()
  if (pathname.endsWith(PATHS.SETTINGS)) {
    await router.navigate(pathname.slice(0, -PATHS.SETTINGS.length))
  }
  if (!signal?.aborted) window.location.reload()
}
