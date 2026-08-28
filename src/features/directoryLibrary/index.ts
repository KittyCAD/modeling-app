import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { fileSystemService } from '@src/contracts/fileSystem'
import {
  projectLibraryDefaultsValueSpec,
  projectLibraryTypesValueSpec,
} from '@src/contracts/projectLibraries'
import { DirectoryLibrarySettingsDetails } from '@src/features/directoryLibrary/DirectoryLibrarySettingsDetails'
import { readDirectoryLibraryRealizations } from '@src/features/directoryLibrary/directoryScanner'
import { createDirectoryLibraryOperations } from '@src/features/directoryLibrary/operations'
import {
  DEFAULT_LIBRARY_TITLE,
  DIRECTORY_LIBRARY_TYPE,
  NEW_LIBRARY_TITLE,
} from '@src/lib/projectLibraries'

/**
 * The `directory` library type: a folder of project folders.
 *
 * The only type today, and the reference for the ones that follow. Everything
 * it knows about directories is confined here — the libraries service, the home
 * screen, and settings all go through the type contribution, so adding cloud or
 * a network share later touches none of them.
 */
export default defineRegistryItemFactory((ctx) => {
  // Lazy: resolving a service in a factory body happens while the registry
  // graph is still being built.
  const getFileSystem = () => ctx.services.get(fileSystemService)

  return {
    item: defineRuntimeRegistryItem({
      id: 'directoryLibrary',
      provides: [
        provide(projectLibraryTypesValueSpec, {
          type: DIRECTORY_LIBRARY_TYPE,
          title: 'Folder',
          icon: 'folder',
          order: 0,
          description: 'Projects in this library are stored on this device.',
          locationLabel: 'Folder',
          settingsDetails: DirectoryLibrarySettingsDetails,
          newLibrarySetting: ({ defaultRoot }) => ({
            title: NEW_LIBRARY_TITLE,
            path: defaultRoot,
            type: DIRECTORY_LIBRARY_TYPE,
          }),
          operations: createDirectoryLibraryOperations(getFileSystem),
          readRealizations: ({ library, signal, excludePaths }) =>
            readDirectoryLibraryRealizations({
              fileSystem: getFileSystem(),
              libraryPath: library.path,
              signal,
              excludePaths,
            }),
        }),

        // The library everyone starts with. Contributed rather than hardcoded
        // in the service, so a build could ship a different starting set.
        provide(projectLibraryDefaultsValueSpec, ({ defaultRoot }) => [
          {
            title: DEFAULT_LIBRARY_TITLE,
            path: defaultRoot,
            type: DIRECTORY_LIBRARY_TYPE,
          },
        ]),
      ],
    }),
  }
}, 'directoryLibrary')
