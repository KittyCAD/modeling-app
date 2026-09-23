import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { LaunchRequest } from '@src/lib/launchRequest'
import type {
  AppDestination,
  AppUrlState,
} from '@src/registry/contracts/appUrl'

export interface AppLaunchInput {
  destination: AppDestination
  urlState: AppUrlState
  request: LaunchRequest
  remainingSearch: string
}

/** Owns one-shot launch requests while authentication and project setup finish. */
export interface AppLaunchService {
  readonly pending: ReadonlySignal<boolean>
  accept: (input: AppLaunchInput) => Promise<void>
  continueInWeb: () => Promise<void>
  cancel: () => void
  dispose: () => void
}

export const { appLaunchService } = defineContract({
  appLaunchService: defineService<AppLaunchService>('application-launch'),
})
