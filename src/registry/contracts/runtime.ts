import type { ReadonlySignal } from '@preact/signals-core'
import { contract, service } from 'plankton'
export type RuntimeTarget = 'desktop' | 'web' | 'server'

export type RuntimeInfo = {
  target: RuntimeTarget
  hasWindow: boolean
  isDesktop: boolean
  isWeb: boolean
  isServer: boolean
  isPlaywright: boolean
  environmentName?: string
  nodeEnv?: string
  baseDomain?: string
  apiBaseUrl?: string
  siteBaseUrl?: string
  appUrl?: string
}

export type RuntimeRegistryService = {
  current: ReadonlySignal<RuntimeInfo>
  get: () => RuntimeInfo
  refresh: () => RuntimeInfo
}
export const runtimeContract = contract({
  runtimeService: service<RuntimeRegistryService>('runtime.service'),
})

export const { runtimeService } = runtimeContract
