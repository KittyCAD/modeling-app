import { isPathNotFoundError } from '@src/lib/desktop'
import { PATHS } from '@src/lib/paths'
import type { ProjectStorage } from '@src/lib/projectSession/storage'
import { reportRejection } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type { ProjectLibrariesService } from '@src/registry/contracts/projectLibraries'
import type { ProjectSessionService } from '@src/registry/contracts/projectSession'
import type { RouterRegistryService } from '@src/registry/contracts/router'

/** A disposed opening must not refresh or navigate a later project. */
export function watchProjectStorage({
  path,
  storage,
  isCurrent,
  fileOperations,
  projectLibraries,
  session,
  router,
}: {
  path: string
  storage: Pick<ProjectStorage, 'watch' | 'externalChanges'>
  isCurrent: () => boolean
  fileOperations: Pick<FileOperationsRegistryService, 'pending'>
  projectLibraries: Pick<ProjectLibrariesService, 'refreshProjects'>
  session: Pick<ProjectSessionService, 'refreshProject'>
  router: Pick<RouterRegistryService, 'navigate'>
}) {
  let disposed = false
  const ownsOpening = () => !disposed && isCurrent()
  const refresh = async () => {
    if (!ownsOpening()) return
    try {
      if (storage.externalChanges === 'files') {
        if (await fileOperations.pending()) return
        if (!ownsOpening()) return
        await projectLibraries.refreshProjects()
      } else {
        await session.refreshProject()
      }
    } catch (error) {
      if (ownsOpening() && isPathNotFoundError(error))
        await router.navigate(PATHS.HOME)
      else reportRejection(error)
    }
  }
  const stop = storage.watch(path, uuidv4(), () => {
    void refresh().catch(reportRejection)
  })
  return () => {
    disposed = true
    stop()
  }
}
