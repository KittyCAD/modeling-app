import { useEffect, useCallback } from 'react'
import { useSignals } from '@preact/signals-react/runtime'
import { useFileSystemWatcher } from '@src/hooks/useFileSystemWatcher'
import { useApp } from '@src/lib/boot'
import { isPathNotFoundError } from '@src/lib/desktop'
import { PATHS } from '@src/lib/paths'
import { reportRejection } from '@src/lib/trap'
import { cloudStorageService } from '@src/registry/contracts/fileOperations'
import { routerService } from '@src/registry/contracts/router'

/** External changes refresh the current project; mutations refresh their own callers. */
// TODO: Move useFileSystemWatcher into ProjectSessionService so the session owns
// watcher setup and teardown independently of React. Keep this wrapper while
// registration and cleanup depend on hooks; removing it before that migration
// would stop native filesystem events from refreshing the project tree.
export function ProjectFileWatcher() {
  useSignals()
  const app = useApp()
  const project = app.project
  const metadata = project?.projectIORefSignal.value
  const refresh = useCallback(async () => {
    if (app.project !== project) return
    // Cloud change notifications arrive before their persistence promise settles.
    // Cloud reads already wait for that promise; local writes refresh explicitly.
    if (
      !project?.projectIORefSignal.peek().cloudProjectId &&
      (await app.fileOperations.pending())
    )
      return
    try {
      if (project?.projectIORefSignal.peek().cloudProjectId)
        await app.projectSession.refreshProject()
      else await app.projectLibraries.refreshProjects()
    } catch (error) {
      if (app.project === project && isPathNotFoundError(error))
        await app.registry.get(routerService).navigate(PATHS.HOME)
      else reportRejection(error)
    }
  }, [app, project])
  useFileSystemWatcher(
    refresh,
    metadata && !metadata.cloudProjectId ? [metadata.path] : []
  )
  useEffect(() => {
    if (!metadata?.cloudProjectId) return
    const stop = app.registry.get(cloudStorageService).subscribe(() => {
      void refresh()
    })
    return () => {
      stop()
    }
  }, [app, metadata?.cloudProjectId, refresh])
  return null
}
