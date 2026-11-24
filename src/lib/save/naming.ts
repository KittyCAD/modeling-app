import { batch, signal, type Signal } from '@preact/signals-core'
import type {
  Editor,
  EditorNaming,
  EditorPathRequest,
  EditorsService,
} from '@src/lib/editors/registry/contract'
import fsZds from '@src/lib/fs-zds'
import { ensureDirectory } from '@src/lib/fileSystem/ensureDirectory'
import { assertProjectPathWithoutSymlinks } from '@src/lib/fileSystem/projectPath'
import { getContainedRelativePath } from '@src/lib/fileSystem/pathContainment'
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
  function parseDestination(
    current: PathRequest,
    value: string
  ): string | Error {
    const root = current.session.project.peek().contents.path
    const path = value.trim()
    // Windows accepts both slash styles, and pasted Windows roots must also
    // be rejected on POSIX. `getContainedRelativePath` uses the backing's separator;
    // the input checks need to recognize both styles regardless of backing.
    if (
      !path ||
      path.endsWith('/') ||
      path.endsWith('\\') ||
      path.startsWith('/') ||
      path.startsWith('\\') ||
      /^[a-zA-Z]:/.test(path) ||
      /[\u0000-\u001f]/.test(path)
    ) {
      return new Error('Enter a relative file path, including a file name')
    }
    let destination = fsZds.resolve(root, path)
    if (
      !getContainedRelativePath(
        { relative: fsZds.relative, sep: fsZds.sep },
        root,
        destination
      )
    )
      return new Error('File path must stay within its project')
    if (!current.source && !fsZds.extname(destination))
      destination += options.defaultExtension ?? ''
    return destination
  }
  function isActive(editor: Editor, current: PathRequest) {
    return (
      entryFor(editor).request === current &&
      !editor.signal.aborted &&
      !current.session.signal.aborted &&
      editor.src.peek() === current.source
    )
  }
  function writableError(editor: Editor, current: PathRequest) {
    if (!isActive(editor, current))
      return new Error('The editor changed while naming')
    if (
      editor.readOnly.peek() ||
      !current.session.project.peek().metadata.readWriteAccess
    )
      return new Error('This editor is read-only')
  }
  async function persistPath(
    editor: Editor,
    current: PathRequest,
    destination: string,
    editors: EditorsService,
    files: FileOperationsRegistryService
  ): Promise<undefined | Error> {
    // `withSourceLock` may wait for earlier saves. The captured editor and
    // project must still be writable when this storage operation starts.
    const before = writableError(editor, current)
    if (before) return before
    const root = current.session.project.peek().contents.path
    if (current.source)
      await assertProjectPathWithoutSymlinks(files, root, current.source)
    await assertProjectPathWithoutSymlinks(files, root, destination)
    const checked = writableError(editor, current)
    if (checked) return checked
    const parent = fsZds.dirname(destination)
    const existingParent = current.source ? fsZds.dirname(current.source) : root
    if (parent !== existingParent) {
      await ensureDirectory(files, parent)
      // The editor or project can close or become read-only while
      // `ensureDirectory` runs. Recheck before creating or moving a file.
      const after = writableError(editor, current)
      if (after) return after
    }
    return current.source
      ? renameFile(current, current.source, destination, editors, files)
      : createFile(editor, current, destination, editors, files)
  }
  async function renameFile(
    current: PathRequest,
    source: string,
    destination: string,
    editors: EditorsService,
    files: FileOperationsRegistryService
  ): Promise<undefined | Error> {
    const affected = editors.editors
      .peek()
      .filter((candidate) => candidate.src.peek() === source)
    await files.rename(source, destination)
    // Publish the confirmed move and buffer paths in one `batch` so
    // Open Editor and the open views observe the same file location.
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
        if (!candidate.signal.aborted && candidate.src.peek() === source) {
          const result = editors.setSource(candidate.id, destination)
          if (isErr(result)) return result
        }
      }
    })
  }
  async function createFile(
    editor: Editor,
    current: PathRequest,
    destination: string,
    editors: EditorsService,
    files: FileOperationsRegistryService
  ): Promise<undefined | Error> {
    // `saving.adopt` must use the text actually passed to `files.createFile`;
    // edits made while creation is pending must remain unsaved.
    const contents = editor.state.doc.toString()
    await files.createFile(destination, contents)
    return batch(() => {
      trap(
        current.projects.applyFileMutation(current.session, {
          type: 'created',
          path: destination,
        })
      )
      if (!isActive(editor, current))
        return new Error('The editor changed while saving')
      const result = editors.setSource(editor.id, destination)
      if (isErr(result)) return result
      return saving.adopt(editor, contents)
    })
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
      const destination = parseDestination(current, value)
      if (isErr(destination)) {
        fail(destination.message)
        return
      }
      const editors = getEditors()
      const files = getFiles()
      if (!editors || !files) {
        fail('File operations are unavailable')
        return
      }
      if (!isActive(editor, current)) {
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
        const mutate = () =>
          persistPath(editor, current, destination, editors, files)
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
