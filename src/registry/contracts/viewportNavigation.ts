import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'

/** Navigation offered by the active viewport; absent when it is unmounted. */
export interface ViewportNavigationService {
  readonly isModelOutOfView: ReadonlySignal<boolean>
  /** Fit the model while preserving the viewing direction and projection. */
  recenter(): Promise<void>
}

export const viewportNavigationContract = defineContract({
  viewportNavigationService: defineService<ViewportNavigationService>(
    'viewport-navigation'
  ),
})

export const { viewportNavigationService } = viewportNavigationContract
