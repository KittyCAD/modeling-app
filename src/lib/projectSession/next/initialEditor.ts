import fsZds from '@src/lib/fs-zds'
import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import type { App } from '@src/lib/app'
import type { OpenProjectSession } from '@src/lib/projectSession/next/contract'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { loadProjectEditor } from '@src/lib/editors/loadProjectEditor'
import { editorsService } from '@src/lib/editors/registry/contract'
import { type FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import { isErr } from '@src/lib/trap'

/** Both project routes choose the configured file, main.kcl, or another KCL file. */
export async function openInitialProjectEditor(
  app: App,
  session: OpenProjectSession,
  signal: AbortSignal,
  fileOperations: Pick<FileOperationsRegistryService, 'readFile'>
) {
  const projects = app.registry.get(projectSessionService)
  const project = session.project.peek()
  const files = projects.listFiles()
  const configured = project.metadata.defaultFile
    ? fsZds.join(project.contents.path, project.metadata.defaultFile)
    : undefined
  const entrypoint = fsZds.join(project.contents.path, PROJECT_ENTRYPOINT)
  const initial =
    files.find((file) => file.path === configured) ??
    files.find((file) => file.path === entrypoint) ??
    files.find((file) => fsZds.extname(file.path).toLowerCase() === '.kcl')
  if (!initial) return
  const editors = app.registry.get(editorsService)
  const editor = await loadProjectEditor(
    initial.path,
    editors,
    () => app.registry.optional(projectSessionService),
    () => fileOperations,
    { signal, reuseExisting: true }
  )
  signal.throwIfAborted()
  if (isErr(editor)) return editor
  if (projects.currentSession.peek() !== session)
    return new Error('The project changed before its editor opened')
  if (!editors.views.peek().some((view) => view.editor === editor)) {
    const view = editors.createView(editor)
    if (isErr(view)) return view
  }
}
