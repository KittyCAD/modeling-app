import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { cloudSyncService } from '@src/contracts/cloudSync'
import { fileSystemService } from '@src/contracts/fileSystem'
import { projectLibraryTypesValueSpec } from '@src/contracts/projectLibraries'
import { CloudLibrarySettingsDetails } from '@src/features/cloudLibrary/CloudLibrarySettingsDetails'
import { readDirectoryLibraryRealizations } from '@src/features/directoryLibrary/directoryScanner'
import { createDirectoryLibraryOperations } from '@src/features/directoryLibrary/operations'
import { basename, joinPath, toDirectoryName } from '@src/lib/paths'
import {
  CLOUD_LIBRARY_TYPE,
  PERSONAL_CLOUD_LIBRARY_TITLE,
} from '@src/lib/projectLibraries'
import './cloudLibrary.css'

/**
 * Personal Cloud as a contributed project-library type.
 *
 * Its projects remain ordinary local folders. Directory operations mutate that
 * materialization first; cloudSync then replicates the result. Neither service
 * needs to know the other's UI or configuration policy.
 */
export default defineRegistryItemFactory((ctx) => {
  const getFileSystem = () => ctx.services.get(fileSystemService)
  const directoryOperations = createDirectoryLibraryOperations(getFileSystem)
  const getSync = () => ctx.services.get(cloudSyncService)

  return {
    item: defineRuntimeRegistryItem({
      id: 'cloudLibrary',
      provides: [
        provide(projectLibraryTypesValueSpec, {
          type: CLOUD_LIBRARY_TYPE,
          title: 'Cloud',
          icon: 'cloud',
          order: 10,
          description: 'Projects in this library sync with your Zoo account.',
          locationLabel: 'Local storage',
          removable: false,
          newLibrarySetting: ({ defaultRoot }) => ({
            title: PERSONAL_CLOUD_LIBRARY_TITLE,
            path: joinPath(defaultRoot, 'cloud'),
            source: 'personal',
            type: CLOUD_LIBRARY_TYPE,
          }),
          settingsDetails: CloudLibrarySettingsDetails,
          operations: {
            createProject: {
              async run(input) {
                const created =
                  await directoryOperations.createProject?.run(input)
                if (created)
                  await getSync().syncProject(input.library, created.path)
                return created
              },
            },
            renameProject: {
              async run(input) {
                const from = input.realization.path
                await directoryOperations.renameProject?.run(input)
                const requestedName = toDirectoryName(input.requestedTitle)
                const candidate = joinPath(input.library.path, requestedName)
                const fileSystem = getFileSystem()
                const to =
                  !(await fileSystem.exists(from)) &&
                  (await fileSystem.exists(candidate))
                    ? candidate
                    : from
                if (to !== from) {
                  await getSync().relocateProject(input.library, from, to)
                }
                await getSync().syncProject(input.library, to)
              },
            },
            deleteProject: {
              run: ({ library, realization }) =>
                getSync().deleteProject(library, realization.path),
            },
            moveProjectTo: {
              async run(input) {
                const moved =
                  await directoryOperations.moveProjectTo?.run(input)
                if (moved)
                  await getSync().syncProject(input.library, moved.path)
                return moved
              },
            },
            moveProjectFrom: {
              async run(input) {
                if (input.targetLibrary.type !== CLOUD_LIBRARY_TYPE) {
                  await getSync().disconnectProject(
                    input.library,
                    input.realization.path
                  )
                }
                await directoryOperations.moveProjectFrom?.run(input)
              },
            },
          },
          readRealizations: async ({ library, signal, excludePaths }) => {
            await getSync()
              .syncLibrary(library)
              .catch(() => {})
            return readDirectoryLibraryRealizations({
              fileSystem: getFileSystem(),
              libraryPath: library.path,
              signal,
              excludePaths,
            })
          },
        }),
      ],
    }),
  }
}, 'cloudLibrary')
