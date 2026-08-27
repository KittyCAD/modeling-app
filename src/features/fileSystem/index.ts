import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { fileSystemService } from '@src/contracts/fileSystem'
import { createElectronFileSystem } from '@src/features/fileSystem/electronFileSystem'
import { createOpfsFileSystem } from '@src/features/fileSystem/opfs'
import { setWasmFileSystemProvider } from '@src/wasm/bridge'

/**
 * Provides the filesystem, and closes the WASM file loop.
 *
 * Picks its implementation from the presence of the desktop bridge rather than
 * from the runtime service, because the filesystem is resolved early and a
 * service reading another service during graph construction is exactly what the
 * registry forbids.
 */
export default defineRegistryItemFactory(() => {
  const bridge = typeof window !== 'undefined' ? window.electron : undefined
  const fileSystem = bridge
    ? createElectronFileSystem(bridge)
    : createOpfsFileSystem()

  /**
   * Hand the same filesystem to the KCL standard library.
   *
   * Paths arriving from WASM are already absolute — KCL resolves imports
   * against the executing file — so they need no rebasing here.
   */
  const releaseWasmProvider = setWasmFileSystemProvider({
    readFile: (path) => fileSystem.readFile(path),
    exists: (path) => fileSystem.exists(path),
    listFiles: async (path) => {
      const entries = await fileSystem.readDirectory(path)
      return entries.map((entry) => entry.name)
    },
  })

  return {
    model: fileSystem,
    item: defineRuntimeRegistryItem({
      id: 'fileSystem',
      dispose: releaseWasmProvider,
      providesServices: [provideService(fileSystemService, fileSystem)],
    }),
  }
}, 'fileSystem')
