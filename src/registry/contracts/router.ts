import type { ReadonlySignal } from '@preact/signals-core'
import { contract, service } from 'plankton'
import type { Location, NavigateFunction } from 'react-router-dom'

export type RouterRuntimeValues = {
  location: Location
  navigate: NavigateFunction
}

/**
 * Shared app routing service.
 *
 * The service is constructed before React Router is mounted, so its public
 * values are non-nullable while `isReady` records whether they have been seeded
 * from an active router runtime.
 */
export type RouterRegistryService = {
  location: ReadonlySignal<Location>
  isReady: ReadonlySignal<boolean>
  navigate: NavigateFunction
  getLocation: () => Location
  setLocation: (location: Location) => void
  setNavigate: (navigate: NavigateFunction) => () => void
  seed: (values: RouterRuntimeValues) => () => void
  reset: () => void
}
export const routerContract = contract({
  routerService: service<RouterRegistryService>('router.service'),
})

export const { routerService } = routerContract
