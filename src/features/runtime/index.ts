import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals'
import { type RuntimeInfo, runtimeService } from '@src/contracts/runtime'

function detect(): RuntimeInfo {
  const isDesktop = typeof window !== 'undefined' && 'electron' in window
  return {
    target: isDesktop ? 'desktop' : 'web',
    isDesktop,
    isWeb: !isDesktop,
    isTest: typeof navigator !== 'undefined' && navigator.webdriver === true,
    // Only ever true on the desktop build: the browser has no traffic lights to
    // leave room for, whatever it is running on.
    isMac: isDesktop && window.electron?.platform === 'darwin',
    version: import.meta.env?.VITE_APP_VERSION ?? '0.0.0-dev',
  }
}

/**
 * Publishes what kind of process we are running in.
 *
 * A signal rather than a constant because the desktop bridge is injected
 * asynchronously in some launch paths, so the first read can be wrong.
 */
export default defineRegistryItemFactory(() => {
  const info = signal(detect())

  return {
    item: defineRuntimeRegistryItem({
      id: 'runtime',
      providesServices: [
        provideService(runtimeService, {
          info: computed(() => info.value),
        }),
      ],
    }),
  }
}, 'runtime')
