import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import env, { getEnvironmentNameFromEnv } from '@src/env'
import { IS_PLAYWRIGHT_KEY } from '@src/lib/constants'
import { isDesktop as detectDesktop } from '@src/lib/isDesktop'
import {
  type RuntimeInfo,
  type RuntimeRegistryService,
  type RuntimeTarget,
  runtimeService,
} from '@src/registry/contracts/runtime'

function readIsPlaywright(hasWindow: boolean) {
  const electronRuntimePlaywright =
    hasWindow && window.electron?.process?.env.NODE_ENV === 'test'
  const browserRuntimePlaywright =
    typeof localStorage !== 'undefined' &&
    localStorage.getItem(IS_PLAYWRIGHT_KEY) === 'true'
  return Boolean(electronRuntimePlaywright || browserRuntimePlaywright)
}

function readRuntimeInfo(): RuntimeInfo {
  const hasWindow = typeof window !== 'undefined'
  const isDesktop = hasWindow && detectDesktop()
  const target: RuntimeTarget = !hasWindow
    ? 'server'
    : isDesktop
      ? 'desktop'
      : 'web'
  const environment = env()

  return {
    target,
    hasWindow,
    isDesktop,
    isWeb: target === 'web',
    isServer: target === 'server',
    isPlaywright: readIsPlaywright(hasWindow),
    environmentName: getEnvironmentNameFromEnv(environment),
    nodeEnv: environment.NODE_ENV,
    baseDomain: environment.VITE_ZOO_BASE_DOMAIN,
    apiBaseUrl: environment.VITE_ZOO_API_BASE_URL,
    siteBaseUrl: environment.VITE_ZOO_SITE_BASE_URL,
    appUrl: environment.VITE_ZOO_SITE_APP_URL,
  }
}

export const runtimeExtension = defineRegistryItemFactory(() => {
  const current = signal(readRuntimeInfo())

  const serviceImpl: RuntimeRegistryService = {
    current,
    get: () => current.value,
    refresh: () => {
      current.value = readRuntimeInfo()
      return current.value
    },
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'runtime-extension',
      providesServices: [provideService(runtimeService, serviceImpl)],
    }),
  }
}, 'runtime-extension')

export default defineRegistryItem({
  id: 'runtime',
  uses: [runtimeExtension],
})
