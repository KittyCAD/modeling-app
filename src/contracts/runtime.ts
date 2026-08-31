import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'

export type RuntimeTarget = 'desktop' | 'web'

export interface RuntimeInfo {
  target: RuntimeTarget
  isDesktop: boolean
  isWeb: boolean
  /** True under automated tests, so features can skip animation and polling. */
  isTest: boolean
  /**
   * True on macOS desktop.
   *
   * Here rather than read off `window.electron` at the point of use, for the
   * reason below: the one thing that turns on it is the frameless window's
   * traffic-light inset, and a lone `process.platform` check buried in a
   * component is exactly the hidden platform assumption this service exists to
   * make visible.
   */
  isMac: boolean
  version: string
}

export interface RuntimeService {
  readonly info: ReadonlySignal<RuntimeInfo>
}

/**
 * What kind of process the app is running in.
 *
 * Kept as a service rather than a module of `if (window.electron)` checks so
 * that a feature's platform assumptions are visible in its dependency list,
 * and so tests can substitute a runtime without touching globals.
 */
export const runtimeContract = defineContract({
  runtimeService: defineService<RuntimeService>('runtime.service'),
})

export const { runtimeService } = runtimeContract
