import { useEffect, useCallback } from 'react'
import { effect } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { useFileSystemWatcher } from '@src/hooks/useFileSystemWatcher'
import { useApp } from '@src/lib/boot'
import { isPathNotFoundError } from '@src/lib/desktop'
import { PATHS } from '@src/lib/paths'
import { reportRejection } from '@src/lib/trap'
import { cloudStorageService } from '@src/registry/contracts/fileOperations'
import { routerService } from '@src/registry/contracts/router'
import { createProjectPoller } from '@src/lib/fs-zds/cloud/polling'
import {
  activeTextFileSignal,
  hasPendingActiveTextFileWrite,
  openActiveTextFile,
  clearActiveTextFile,
} from '@src/lib/activeTextFile'
import { zookeeperPromptRunningSignal } from '@src/lib/zookeeper/zookeeperPromptState'
import { CloudApiError } from '@src/lib/fs-zds/cloud/api'

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
  useEffect(() => {
    const id = metadata?.cloudProjectId
    if (!id || !project) return
    const cloud = app.registry.get(cloudStorageService)
    let active = true
    const isCurrent = () => active && app.project === project
    const visible = () =>
      document.visibilityState !== 'hidden' && navigator.onLine
    const canApply = () =>
      isCurrent() &&
      visible() &&
      !zookeeperPromptRunningSignal.peek() &&
      !hasPendingActiveTextFileWrite(project.path) &&
      [...project.editors.values()].every(
        (editor) =>
          !editor.hasUnsavedLocalChanges() &&
          !editor.writingPromise.peek() &&
          !project.files.some(
            (file) => editor.getPendingFileCode(file.path) !== undefined
          )
      )
    const poller = createProjectPoller({
      check: async () => {
        const update = await cloud.checkForUpdates(id, canApply)
        if (update.refreshed && canApply()) {
          await project.reloadFilesFromStorage(canApply)
          if (!canApply()) return update.changed
          const editorPath = project.executingPath
          const text = activeTextFileSignal.peek()
          const selectedPath = text?.path ?? editorPath
          const stillSelected = () =>
            canApply() &&
            project.executingPath === editorPath &&
            activeTextFileSignal.peek() === text
          if (
            selectedPath &&
            !(await app.fileOperations.exists(selectedPath))
          ) {
            const entrypoint = project.projectIORefSignal.peek().default_file
            const exists = await app.fileOperations.exists(entrypoint)
            if (stillSelected() && exists) {
              clearActiveTextFile()
              await app.projectSession.openFile(entrypoint, {
                projectPath: project.path,
              })
            }
          } else if (text && stillSelected()) {
            await openActiveTextFile(app.fileOperations, text.path)
          }
        }
        return update.changed
      },
      onError: (error) => {
        if (
          error instanceof CloudApiError &&
          error.status === 404 &&
          canApply()
        )
          void Promise.resolve(
            app.registry.get(routerService).navigate(PATHS.HOME)
          ).catch(reportRejection)
        else reportRejection(error)
      },
    })
    const stopActivity = cloud.subscribeActivity((projectId) => {
      if (projectId === id) poller.activity()
    })
    let wasRunning = zookeeperPromptRunningSignal.peek()
    const stopPrompt = effect(() => {
      const running = zookeeperPromptRunningSignal.value
      if (wasRunning && !running) poller.checkNow()
      wasRunning = running
    })
    const updateVisibility = () => poller.setEnabled(visible())
    const focus = () => {
      if (visible()) poller.checkNow()
    }
    document.addEventListener('visibilitychange', updateVisibility)
    window.addEventListener('online', updateVisibility)
    window.addEventListener('offline', updateVisibility)
    window.addEventListener('focus', focus)
    updateVisibility()
    return () => {
      active = false
      poller.dispose()
      stopActivity()
      stopPrompt()
      document.removeEventListener('visibilitychange', updateVisibility)
      window.removeEventListener('online', updateVisibility)
      window.removeEventListener('offline', updateVisibility)
      window.removeEventListener('focus', focus)
    }
  }, [app, project, metadata?.cloudProjectId])
  return null
}
