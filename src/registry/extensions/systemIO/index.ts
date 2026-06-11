import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { effect, signal } from '@preact/signals-core'
import fsZds from '@src/lib/fs-zds'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import { settingsService } from '@src/registry/contracts/settings'
import {
  type ProjectHandle,
  type SystemIOService,
  systemIOService,
} from '@src/registry/contracts/systemIO'

type ProjectHandleWithModified = ProjectHandle & {
  modified: number
}

export async function listProjectHandlesFromProjectDirectory(
  projectDirectoryPath: string
): Promise<readonly ProjectHandle[]> {
  if (!projectDirectoryPath) {
    return []
  }

  let entries: string[]
  try {
    entries = await fsZds.readdir(projectDirectoryPath)
  } catch {
    return []
  }

  const handles: ProjectHandleWithModified[] = []

  for (const entry of entries) {
    if (entry.startsWith('.')) {
      continue
    }

    const path = fsZds.join(projectDirectoryPath, entry)

    try {
      const stat = await fsZds.stat(path)
      if (!(stat.mode & fsZdsConstants.S_IFDIR)) {
        continue
      }

      handles.push({ path, modified: stat.mtimeMs })
    } catch {
      continue
    }
  }

  return handles
    .sort((a, b) => b.modified - a.modified)
    .map(({ path }) => ({ path }))
}

export const systemIOExtension = defineRegistryItemFactory((ctx) => {
  const projectHandles = signal<readonly ProjectHandle[]>([])
  let latestProjectDirectoryPath = ''
  let disposed = false
  let disposeSettingsEffect: (() => void) | undefined

  const getProjectDirectoryPath = () =>
    ctx.services.optional(settingsService)?.current.value.app.projectDirectory
      .current ?? ''

  const refreshProjectHandlesFromDirectory = async (
    projectDirectoryPath: string
  ) => {
    latestProjectDirectoryPath = projectDirectoryPath
    const nextProjectHandles =
      await listProjectHandlesFromProjectDirectory(projectDirectoryPath)

    if (projectDirectoryPath === latestProjectDirectoryPath) {
      projectHandles.value = nextProjectHandles
    }

    return nextProjectHandles
  }

  const refreshProjectHandles: SystemIOService['refreshProjectHandles'] =
    () => {
      return refreshProjectHandlesFromDirectory(getProjectDirectoryPath())
    }

  queueMicrotask(() => {
    if (disposed) {
      return
    }

    disposeSettingsEffect = effect(() => {
      void refreshProjectHandlesFromDirectory(getProjectDirectoryPath())
    })
  })

  const serviceImpl: SystemIOService = {
    projectHandles,
    refreshProjectHandles,
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'system-io-extension',
      providesServices: [provideService(systemIOService, serviceImpl)],
      dispose: () => {
        disposed = true
        disposeSettingsEffect?.()
      },
    }),
  }
}, 'system-io-extension')

const systemIORegistryItem = defineRegistryItem({
  id: 'systemIO',
  uses: [systemIOExtension],
})

export default systemIORegistryItem
