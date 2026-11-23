import { batch, signal, type Signal } from '@preact/signals-core'
import type {
  Editor,
  EditorNaming,
  EditorPathRequest,
  EditorsService,
} from '@src/lib/editors/registry/contract'
import fsZds from '@src/lib/fs-zds'
import { ensureDirectory } from '@src/lib/fileSystem/ensureDirectory'
import type {
  OpenProjectSession,
  ProjectSessionService,
} from '@src/lib/projectSession/next/contract'
import type { EditorSave } from '@src/lib/save/registry/contract'
import { isErr, trap } from '@src/lib/trap'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

/** A naming transaction retains the original opening until it completes or is cancelled. */
interface PathRequest {
  projects: ProjectSessionService
  session: OpenProjectSession
  source: string | undefined
  result: Promise<undefined | Error>
  resolve: (result: undefined | Error) => void
  cleanup: () => void
}

/** Path requests capture their project opening and source before any asynchronous work. */
export function createEditorNaming(
  getProjects: () => ProjectSessionService | undefined,
  getEditors: () => EditorsService | undefined,
  getFiles: () => FileOperationsRegistryService | undefined,
  saving: EditorSave,
  withSourceLock: (
    src: string,
    operation: () => Promise<undefined | Error>
  ) => Promise<undefined | Error>,
  focusEditor: (editor: Editor) => void,
  options: { defaultExtension?: `.${string}` } = {}
) {
  const entries = new WeakMap<Editor, ReturnType<typeof createEntry>>()
  const activeEditors = new Set<Editor>()
  const focusedViews = new WeakMap<Editor, symbol>()
  function createEntry(): {
    state: Signal<EditorPathRequest | undefined>
    request: PathRequest | undefined
  } {
    return {
      state: signal<EditorPathRequest | undefined>(undefined),
      request: undefined,
    }
  }
  function entryFor(editor: Editor) {
    let entry = entries.get(editor)
    if (!entry) {
      entry = createEntry()
      entries.set(editor, entry)
    }
    return entry
  }
  function complete(editor: Editor, result?: Error) {
    const entry = entryFor(editor)
    const request = entry.request
    entry.request = undefined
    activeEditors.delete(editor)
    entry.state.value = undefined
    request?.cleanup()
    request?.resolve(result)
  }
  function request(
    editor: Editor,
    viewId?: symbol
  ): Promise<undefined | Error> {
    const entry = entryFor(editor)
    if (entry.request) return entry.request.result
    const projects = getProjects()
    const session = projects?.currentSession.peek()
    if (!projects || !session || session.signal.aborted)
      return Promise.resolve(new Error('Open a project before naming a buffer'))
    if (
      editor.signal.aborted ||
      editor.readOnly.peek() ||
      !session.project.peek().metadata.readWriteAccess
    )
      return Promise.resolve(new Error('This editor is read-only or closed'))
    const source = editor.src.peek()
    let resolve!: (result: undefined | Error) => void
    const result = new Promise<undefined | Error>((done) => {
      resolve = done
    })
    const abort = () =>
      complete(editor, new Error('The editor or project was closed'))
    editor.signal.addEventListener('abort', abort, { once: true })
    session.signal.addEventListener('abort', abort, { once: true })
    activeEditors.add(editor)
    entry.request = {
      projects,
      session,
      source,
      result,
      resolve,
      cleanup: () => {
        editor.signal.removeEventListener('abort', abort)
        session.signal.removeEventListener('abort', abort)
      },
    }
    const views =
      getEditors()
        ?.views.peek()
        .filter((view) => view.editor === editor) ?? []
    entry.state.value = {
      viewId:
        viewId ??
        views.find((view) =>
          view.element.peek()?.contains(document.activeElement)
        )?.id ??
        focusedViews.get(editor) ??
        views[0]?.id,
      initialPath: source
        ? fsZds.relative(session.project.peek().contents.path, source)
        : '',
      pending: false,
    }
    return result
  }
  const service: EditorNaming = {
    focus: (editor, viewId) => {
      focusEditor(editor)
      if (viewId) focusedViews.set(editor, viewId)
    },
    state: (editor) => entryFor(editor).state,
    rename: (editor, viewId) => {
      void request(editor, viewId)
      // The promise reports to Save callers; rename failures also need a synchronous boundary.
      if (!entryFor(editor).request)
        return new Error('Open a writable project and editor before renaming')
    },
    cancel: (editor) => {
      if (!entryFor(editor).state.peek()?.pending) complete(editor)
    },
    submit: async (editor, value) => {
      const entry = entryFor(editor)
      const current = entry.request
      const state = entry.state.peek()
      if (!current || !state || state.pending) return
      const fail = (message: string) => {
        if (entry.request === current)
          entry.state.value = { ...state, pending: false, error: message }
      }
      const root = current.session.project.peek().contents.path
      const path = value.trim()
      if (
        !path ||
        path.endsWith('/') ||
        path.endsWith('\\') ||
        path.startsWith('/') ||
        path.startsWith('\\') ||
        /^[a-zA-Z]:/.test(path) ||
        /[\u0000-\u001f]/.test(path)
      ) {
        fail('Enter a relative file path, including a file name')
        return
      }
      let destination = fsZds.resolve(root, path)
      const relative = fsZds.relative(root, destination)
      if (
        !relative ||
        relative === '..' ||
        relative.startsWith(`..${fsZds.sep}`)
      ) {
        fail('File path must stay within its project')
        return
      }
      if (!current.source && !fsZds.extname(destination))
        destination += options.defaultExtension ?? ''
      const editors = getEditors()
      const files = getFiles()
      if (!editors || !files) {
        fail('File operations are unavailable')
        return
      }
      const active = () =>
        entry.request === current &&
        !editor.signal.aborted &&
        !current.session.signal.aborted &&
        editor.src.peek() === current.source
      if (!active()) {
        complete(editor, new Error('The editor changed while naming'))
        return
      }
      if (destination === current.source) {
        complete(editor)
        return
      }
      if (
        editors.editors
          .peek()
          .some((other) => other !== editor && other.src.peek() === destination)
      ) {
        fail('That path is already open in another buffer')
        return
      }
      entry.state.value = { ...state, pending: true }
      try {
        const mutate = async (): Promise<undefined | Error> => {
          if (!active()) return new Error('The editor changed while naming')
          if (
            editor.readOnly.peek() ||
            !current.session.project.peek().metadata.readWriteAccess
          )
            return new Error('This editor is read-only')
          if (current.source) {
            const source = current.source
            const parent = fsZds.dirname(destination)
            if (parent !== fsZds.dirname(source)) {
              await ensureDirectory(files, parent)
              if (!active()) return new Error('The editor changed while naming')
              if (
                editor.readOnly.peek() ||
                !current.session.project.peek().metadata.readWriteAccess
              )
                return new Error('This editor is read-only')
            }
            const affected = editors.editors
              .peek()
              .filter((candidate) => candidate.src.peek() === current.source)
            await files.rename(current.source, destination)
            return batch(() => {
              trap(
                current.projects.applyFileMutation(current.session, {
                  type: 'renamed',
                  source,
                  destination,
                })
              )
              if (current.session.signal.aborted)
                return new Error('The project closed while renaming')
              // Closing the initiating buffer must not strand other buffers at the old path.
              for (const candidate of affected) {
                if (
                  !candidate.signal.aborted &&
                  candidate.src.peek() === current.source
                ) {
                  const result = editors.setSource(candidate.id, destination)
                  if (isErr(result)) return result
                }
              }
            })
          } else {
            const contents = editor.state.doc.toString()
            await files.createFile(destination, contents)
            return batch(() => {
              trap(
                current.projects.applyFileMutation(current.session, {
                  type: 'created',
                  path: destination,
                })
              )
              if (!active()) return new Error('The editor changed while saving')
              const result = editors.setSource(editor.id, destination)
              if (isErr(result)) return result
              return saving.adopt(editor, contents)
            })
          }
        }
        const result = current.source
          ? await withSourceLock(current.source, mutate)
          : await mutate()
        if (isErr(result)) {
          fail(result.message)
          return
        }
        complete(editor)
      } catch (cause) {
        fail(isErr(cause) ? cause.message : 'Unable to name this buffer')
      }
    },
  }
  return {
    service,
    request,
    dispose: () => {
      for (const editor of activeEditors) complete(editor)
    },
  }
}
