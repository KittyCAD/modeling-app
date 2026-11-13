import type { ReadonlySignal } from '@preact/signals-core'
import type { KclManager } from '@src/lang/KclManager'
import type { ProjectStorage } from '@src/lib/projectSession/storage'
import type { TextFileIO } from '@src/lib/projectSession/textFileIO'

type SaveRetryEditor = Pick<
  KclManager,
  | 'path'
  | 'code'
  | 'flushWriteToFile'
  | 'synchronizeCurrentEditorAfterDirectGlobalReplay'
> & { readonly textFileIO: Pick<TextFileIO, 'read'> }

type SaveRetryProject = {
  readonly path: string
  readonly executingEditor: ReadonlySignal<SaveRetryEditor | null | undefined>
}

/** Retry the captured project's save without reconciling a later editor or edit. */
export async function retryProjectSave({
  getProject,
  storageFor,
}: {
  getProject: () => SaveRetryProject | undefined
  storageFor: (path: string) => Pick<ProjectStorage, 'saveState' | 'retry'>
}): Promise<Error | undefined> {
  try {
    const project = getProject()
    if (!project) return
    const storage = storageFor(project.path)
    const editor = project.executingEditor.peek()
    if (!storage.saveState) {
      if (editor && !(await editor.flushWriteToFile())) {
        return new Error('File has unsaved changes that could not be written.')
      }
      return
    }

    const path = editor?.path
    const isCurrent = () =>
      getProject() === project &&
      project.executingEditor.peek() === editor &&
      editor?.path === path
    await storage.retry()
    if (!editor || !isCurrent()) return
    const contents = await editor.textFileIO.read(editor.path)
    if (
      isCurrent() &&
      storage.saveState.peek()?.state === 'saved' &&
      editor.code === contents
    ) {
      editor.synchronizeCurrentEditorAfterDirectGlobalReplay({
        filePath: editor.path,
        nextContent: contents,
        shouldSyncRust: false,
      })
    }
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error('Retrying the save failed.')
  }
}
