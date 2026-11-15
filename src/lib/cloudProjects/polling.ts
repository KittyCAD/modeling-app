import { effect } from '@preact/signals-core'
import type { CloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import type { ProjectSessionService } from '@src/registry/contracts/projectSession'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type { RouterRegistryService } from '@src/registry/contracts/router'
import type { ZDSProject } from '@src/lib/projectSession'
import { PATHS } from '@src/lib/paths'
import { reportRejection } from '@src/lib/trap'
import { createProjectPoller } from '@src/lib/cloudProjects/runtime/polling'
import {
  activeTextFileSignal,
  hasPendingActiveTextFileWrite,
  openActiveTextFile,
  clearActiveTextFile,
} from '@src/lib/activeTextFile'
import { zookeeperPromptRunningSignal } from '@src/lib/zookeeper/zookeeperPromptState'
import { CloudApiError } from '@src/lib/cloudProjects/runtime/api'

/** Polls only while this opening owns the session; dirty buffers delay snapshot adoption. */
export function watchCloudProject({
  cloud,
  session,
  project,
  id,
  fileOperations,
  router,
}: {
  cloud: CloudStorageService
  session: ProjectSessionService
  project: ZDSProject
  id: string
  fileOperations: FileOperationsRegistryService
  router: RouterRegistryService
}) {
  let active = true
  const isCurrent = () => active && session.project.peek() === project
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
  let snapshotGeneration = 0
  let snapshotRefresh = Promise.resolve()
  const refreshSnapshot = async (isSnapshotCurrent: () => boolean) => {
    if (!isSnapshotCurrent()) return
    await project.reloadFilesFromStorage(isSnapshotCurrent)
    if (!isSnapshotCurrent()) return
    const editorPath = project.executingPath
    const text = activeTextFileSignal.peek()
    const selectedPath = text?.path ?? editorPath
    const stillSelected = () =>
      isSnapshotCurrent() &&
      project.executingPath === editorPath &&
      activeTextFileSignal.peek() === text
    if (selectedPath && !(await fileOperations.exists(selectedPath))) {
      const entrypoint = project.projectIORefSignal.peek().default_file
      const exists = await fileOperations.exists(entrypoint)
      if (stillSelected() && exists) {
        clearActiveTextFile()
        await session.openFile(entrypoint, {
          projectPath: project.path,
        })
      }
    } else if (text && stillSelected()) {
      await openActiveTextFile(fileOperations, text.path)
    }
  }
  const poller = createProjectPoller({
    check: async () => {
      const update = await cloud.checkForUpdates(id, canApply)
      if (update.refreshed) {
        const generation = ++snapshotGeneration
        const isSnapshotCurrent = () =>
          generation === snapshotGeneration && canApply()
        // Rust snapshot rebuilding can take much longer than a metadata poll.
        // Keep downloads responsive, serialize rebuilds, and skip superseded ones.
        snapshotRefresh = snapshotRefresh
          .then(() => refreshSnapshot(isSnapshotCurrent))
          .catch(reportRejection)
      }
      return update.changed
    },
    onError: (error) => {
      if (error instanceof CloudApiError && error.status === 404 && canApply())
        void Promise.resolve(router.navigate(PATHS.HOME)).catch(reportRejection)
      else reportRejection(error)
    },
  })
  const stopActivity = cloud.subscribeProjectChanges((projectId) => {
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
}
