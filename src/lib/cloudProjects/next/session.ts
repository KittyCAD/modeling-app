import fsZds from '@src/lib/fs-zds'
import { getContainedRelativePath } from '@src/lib/fileSystem/pathContainment'
import { Transaction } from '@codemirror/state'
import { batch, effect, untracked } from '@preact/signals-core'
import type { CloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import { createProjectPoller } from '@src/lib/cloudProjects/runtime/polling'
import { projectFromCloudSnapshot } from '@src/lib/cloudProjects/next/snapshot'
import type { EditorsService } from '@src/lib/editors/registry/contract'
import type {
  OpenProjectSession,
  ProjectSessionService,
} from '@src/lib/projectSession/next/contract'
import type { EditorSave } from '@src/lib/save/registry/contract'
import { reportRejection } from '@src/lib/trap'

/** One cloud opening owns its poller, snapshot veto, and editor subscriptions. */
export function watchCloudEditorSession({
  cloud,
  session,
  projects,
  editors,
  saving,
}: {
  cloud: CloudStorageService
  session: OpenProjectSession
  projects: ProjectSessionService
  editors: EditorsService
  saving: EditorSave
}) {
  const id = session.project.peek().storage?.projectId
  if (!id) return () => {}
  const root = session.project.peek().contents.path
  const paths = { relative: fsZds.relative, sep: fsZds.sep }
  const belongs = (src: string | undefined) =>
    !src || getContainedRelativePath(paths, root, src) !== undefined
  const current = () =>
    !session.signal.aborted && projects.currentSession.peek() === session
  const visible = () =>
    document.visibilityState !== 'hidden' && navigator.onLine
  const clean = () =>
    current() &&
    editors.editors
      .peek()
      .filter(
        (editor) => Boolean(editor.src.peek()) && belongs(editor.src.peek())
      )
      .every((editor) => {
        const state = saving.state(editor).peek()
        return !state.dirty && !state.saving
      })
  const stopSnapshots = cloud.watchSnapshots({
    projectId: id,
    canApply: clean,
    onApply: (files, adoptedRemote) => {
      if (!current()) return
      if (!adoptedRemote && !clean()) return
      const contents = new Map(
        files.map((file) => [
          file.relativePath,
          new TextDecoder().decode(file.data),
        ])
      )
      batch(() => {
        for (const editor of editors.editors.peek()) {
          const src = editor.src.peek()
          if (!belongs(src)) continue
          const relative =
            src === undefined
              ? undefined
              : getContainedRelativePath(paths, root, src)?.replaceAll(
                  '\\',
                  '/'
                )
          const text =
            relative === undefined ? undefined : contents.get(relative)
          if (text === undefined) {
            if (src) editors.closeEditor(editor.id)
          } else {
            editor.dispatch({
              changes: { from: 0, to: editor.state.doc.length, insert: text },
              annotations: Transaction.addToHistory.of(false),
            })
            saving.adopt(editor, text)
          }
        }
        projects.updateProject(
          session,
          projectFromCloudSnapshot(session.project.peek(), files)
        )
      })
    },
  })
  const poller = createProjectPoller({
    check: async () =>
      (await cloud.checkForUpdates(id, () => clean() && visible())).changed,
    onError: reportRejection,
  })
  const subscriptions = new Map<symbol, () => void>()
  const syncEditors = () => {
    const open = editors.editors.peek()
    for (const [id, stop] of subscriptions)
      if (!open.some((editor) => editor.id === id)) {
        stop()
        subscriptions.delete(id)
      }
    for (const editor of open)
      if (!subscriptions.has(editor.id))
        subscriptions.set(
          editor.id,
          editor.subscribe((transaction) => {
            if (!transaction.docChanged || !current()) return
            const src = editor.src.peek()
            if (src && belongs(src)) cloud.editorChanged(src)
            poller.activity()
          })
        )
  }
  // The registry bridge observes membership; document updates use editor subscriptions.
  const updateVisibility = () => poller.setEnabled(visible() && current())
  const focus = () => {
    if (visible() && current()) poller.checkNow()
  }
  const stopActivity = cloud.subscribeProjectChanges((projectId) => {
    if (projectId === id) poller.activity()
  })
  document.addEventListener('visibilitychange', updateVisibility)
  const online = () => {
    updateVisibility()
    if (current() && cloud.saves.peek().get(id)?.state === 'failed')
      void cloud.retry(id).catch(reportRejection)
  }
  window.addEventListener('online', online)
  window.addEventListener('offline', updateVisibility)
  window.addEventListener('focus', focus)
  const stopEditors = effect(() => {
    void editors.editors.value
    untracked(syncEditors)
  })
  updateVisibility()
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    session.signal.removeEventListener('abort', dispose)
    stopEditors()
    poller.dispose()
    stopSnapshots()
    stopActivity()
    for (const stop of subscriptions.values()) stop()
    document.removeEventListener('visibilitychange', updateVisibility)
    window.removeEventListener('online', online)
    window.removeEventListener('offline', updateVisibility)
    window.removeEventListener('focus', focus)
  }
  session.signal.addEventListener('abort', dispose, { once: true })
  if (session.signal.aborted) dispose()
  return dispose
}
