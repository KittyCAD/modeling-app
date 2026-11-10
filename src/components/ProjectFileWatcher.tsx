import { useEffect } from 'react'
import { useSignals } from '@preact/signals-react/runtime'
import { useApp } from '@src/lib/boot'
import { isPathNotFoundError } from '@src/lib/desktop'
import { PATHS } from '@src/lib/paths'
import { reportRejection } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import { routerService } from '@src/registry/contracts/router'

/** Observes the selected project's backing; storage providers own their watch transport. */
export function ProjectFileWatcher() {
  useSignals()
  const app = useApp()
  const project = app.projectSignal.value
  const path = project?.path
  useEffect(() => {
    if (!project || !path) return
    const storage = app.projectSession.storageFor(path)
    const refresh = async () => {
      if (app.project !== project) return
      if (
        storage.externalChanges === 'files' &&
        (await app.fileOperations.pending())
      )
        return
      try {
        if (storage.externalChanges === 'snapshot')
          await app.projectSession.refreshProject()
        else await app.projectLibraries.refreshProjects()
      } catch (error) {
        if (app.project === project && isPathNotFoundError(error))
          await app.registry.get(routerService).navigate(PATHS.HOME)
        else reportRejection(error)
      }
    }
    return storage.watch(path, uuidv4(), () => {
      void refresh().catch(reportRejection)
    })
  }, [app, project, path])
  return null
}
