import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { fileWatcherService } from '@src/contracts/fileWatcher'
import { createElectronFileWatcher } from '@src/features/fileWatcher/createElectronFileWatcher'

/**
 * Provides the filesystem watcher, on the platforms that have one.
 *
 * The web build contributes nothing at all — no stub, no no-op object. The
 * origin-private filesystem is reachable only by this app, so there is no
 * external editor to notice; a watcher there would be a promise the platform
 * cannot keep. Consumers resolve the service optionally and carry on without it.
 *
 * Chosen from the presence of the desktop bridge rather than the runtime
 * service, like the filesystem: this runs during graph construction, where
 * resolving a service is not allowed.
 */
export default defineRegistryItemFactory(() => {
  const bridge = typeof window !== 'undefined' ? window.electron : undefined
  if (!bridge) {
    return { item: defineRuntimeRegistryItem({ id: 'fileWatcher' }) }
  }

  const watcher = createElectronFileWatcher(bridge)

  return {
    model: watcher,
    item: defineRuntimeRegistryItem({
      id: 'fileWatcher',
      dispose: () => watcher.dispose(),
      providesServices: [provideService(fileWatcherService, watcher)],
    }),
  }
}, 'fileWatcher')
