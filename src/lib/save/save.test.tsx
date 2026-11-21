import '@src/lib/projectSession/next/testFeature'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import markdownExtension from '@src/lib/markdown/registry'
import kclExtension from '@src/lib/kcl/registry'
import executorsExtension from '@src/lib/executors/registry'
import {
  NEW_EDITOR_COMMAND,
  OPEN_EDITOR_COMMAND,
} from '@src/lib/editors/commands'
import { requireSuccess, codeSurface } from '@src/lib/editors/testViews'
import { Registry, contribute, provide, slot } from 'plankton'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import savingExtension, {
  SAVE_EDITOR_COMMAND,
  saveExtension,
} from '@src/lib/save/registry'
import {
  editorSaveService,
  editorOnSaveFacet,
} from '@src/lib/save/registry/contract'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorNamingService,
  editorCapabilityFacet,
  editorTabIndicatorsFacet,
  editorsService,
  type Editor,
} from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import { EditorView } from '@src/lib/editors/EditorView'
import { editorViewsFacet } from '@src/lib/editors/registry/contract'
import { EditorsPane } from '@src/lib/editors/EditorsPane'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { LayoutType } from '@src/lib/layout/types'
import { commandsFacet } from '@src/registry/contracts/commands'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { createProjectSessionService } from '@src/lib/projectSession/next/session'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
vi.mock('@src/lib/paths', () => ({
  PATHS: {
    INDEX: '/',
  },
}))
function deferred() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return {
    promise,
    resolve,
    reject,
  }
}
describe('contributed editor saving', () => {
  let registry: Registry
  const writeFile = vi.fn<typeof testFileOperations.writeFile>()
  const createFile = vi.fn<typeof testFileOperations.createFile>()
  const rename = vi.fn<typeof testFileOperations.rename>()
  const extra = slot()
  beforeAll(async () => {
    await moduleFsViaModuleImport({
      type: StorageName.NodeFS,
      options: {},
    })
  })
  beforeEach(async () => {
    createFile.mockReset().mockResolvedValue(undefined)
    rename.mockReset().mockResolvedValue(undefined)
    writeFile.mockReset().mockResolvedValue(undefined)
    registry = new Registry()
    await registry.configure([
      editorsExtension,
      savingExtension,
      extra,
      [
        provide(fileOperationsService, {
          ...testFileOperations,
          writeFile,
          createFile,
          rename,
        }),
      ],
    ])
  })
  afterEach(async () => {
    cleanup()
    await registry.dispose()
  })
  const open = (src = '/project/notes.txt') => {
    const editors = registry.required(editorsService)
    const editor = requireSuccess(editors.openEditor(src, 'original'))
    editors.createView(editor)
    return editor
  }
  const change = (editor: Editor, text: string) =>
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: text,
      },
    })
  const saving = () => registry.required(editorSaveService)
  it('targets the Modeling document after clicking its background without focusing Code first', async () => {
    await registry.replace(extra, [
      [
        contribute(editorViewsFacet, () =>
          defineEditorView({
            id: 'modeling',
            label: 'Modeling',
            matches: '*' as const,
            priority: 1000,
            Component: () => (
              <div aria-label="Model background">
                <button type="button">Scene control</button>
              </div>
            ),
          })
        ),
      ],
    ])
    const editors = registry.required(editorsService)
    const first = open('/first.kcl')
    const second = open('/second.kcl')
    change(second, 'second model')
    render(
      <>
        <EditorView instance={editors.views.peek()[0]} editors={editors} />
        <EditorView instance={editors.views.peek()[1]} editors={editors} />
      </>
    )
    const backgrounds = screen.getAllByLabelText('Model background')
    fireEvent.pointerDown(backgrounds[0])
    fireEvent.pointerDown(backgrounds[1])
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toContainElement(backgrounds[1])
    const command = registry
      .get(commandsFacet)
      .find(({ id }) => id === SAVE_EDITOR_COMMAND.id)
    await command?.onSubmit()
    await vi.waitFor(() =>
      expect(writeFile).toHaveBeenCalledExactlyOnceWith(
        second.src.peek(),
        'second model'
      )
    )
    expect(saving().lastFocusedEditor.peek()).toBe(second)
    expect(first.contents.peek()).toBe('original')
    expect(saving().state(second).peek().dirty).toBe(false)
    const control = screen.getAllByRole('button', {
      name: 'Scene control',
    })[1]
    fireEvent.pointerDown(control)
    control.focus()
    expect(document.activeElement).toBe(control)
  })
  it('finishes saving while another view of the document remains open', async () => {
    const editor = open()
    const editors = registry.required(editorsService)
    const first = editors.views.peek()[0]
    const second = requireSuccess(editors.createView(editor))
    const pending = deferred()
    writeFile.mockReturnValueOnce(pending.promise)
    change(editor, 'shared contents')
    const saved = saving().save(editor)
    editors.closeView(first.id)
    pending.resolve()
    expect(await saved).toBeUndefined()
    expect(second.codeView.peek()!.state.doc.toString()).toBe('shared contents')
    expect(saving().state(editor).peek().dirty).toBe(false)
    expect(writeFile).toHaveBeenCalledWith(editor.src.peek(), 'shared contents')
    editors.closeView(second.id)
    expect(await saving().save(editor)).toBeInstanceOf(Error)
  })
  it('keeps unnamed buffers dirty and refuses IO until a source is assigned', async () => {
    const editors = registry.required(editorsService)
    const editor = requireSuccess(editors.createEditor())
    expect(saving().state(editor).value.dirty).toBe(true)
    expect(await saving().save(editor)).toBeInstanceOf(Error)
    expect(writeFile).not.toHaveBeenCalled()
    editors.setSource(editor.id, '/project/new.txt')
    await saving().save(editor)
    expect(writeFile).toHaveBeenCalledWith('/project/new.txt', '')
    expect(saving().state(editor).value.dirty).toBe(false)
  })
  async function namingProject() {
    const projects = createProjectSessionService(testFileOperations)
    projects.openProject({
      contents: { name: 'project', path: '/project', children: [] },
      metadata: { title: 'Project', readWriteAccess: true },
    })
    await registry.replace(extra, [[provide(projectSessionService, projects)]])
    return projects
  }
  const naming = () => registry.required(editorNamingService)
  function renderNamingPane() {
    render(
      <EditorsPane
        editors={registry.required(editorsService)}
        naming={naming()}
        layout={{
          id: 'editors',
          label: 'Editors',
          type: LayoutType.Simple,
          areaType: 'editors',
        }}
      />
    )
  }
  it('prompts on first Save, validates the relative path, and names the same buffer', async () => {
    await namingProject()
    const editors = registry.required(editorsService)
    const editor = requireSuccess(editors.createEditor('unsaved contents'))
    editors.createView(editor)
    renderNamingPane()
    let saved!: Promise<undefined | Error>
    act(() => {
      saved = saving().save(editor)
    })
    const input = screen.getByRole('textbox', {
      name: 'Project-relative file path',
    })
    expect(input).toHaveFocus()
    expect(input.closest('button')).toBeNull()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a relative file path'
    )
    expect(createFile).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'notes.txt' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await act(async () => {
      expect(await saved).toBeUndefined()
    })
    expect(createFile).toHaveBeenCalledWith(
      '/project/notes.txt',
      'unsaved contents'
    )
    expect(editor.src.peek()).toBe('/project/notes.txt')
    expect(screen.getByRole('tab', { name: 'notes.txt' })).toBeInTheDocument()
    expect(saving().state(editor).peek().dirty).toBe(false)
  })
  it.each([
    { path: 'bracket', source: '/project/bracket.kcl', language: 'kcl' },
    {
      path: 'models.v1/bracket',
      source: '/project/models.v1/bracket.kcl',
      language: 'kcl',
    },
    { path: ' bracket ', source: '/project/bracket.kcl', language: 'kcl' },
    { path: 'bracket.KCL', source: '/project/bracket.KCL', language: 'kcl' },
    { path: 'notes.md', source: '/project/notes.md', language: 'markdown' },
  ])(
    'applies the ZDS first-save extension policy to "$path"',
    async ({ path, source, language }) => {
      const projects = await namingProject()
      await registry.replace(extra, [
        kclExtension,
        markdownExtension,
        provide(projectSessionService, projects),
      ])
      const editor = requireSuccess(
        registry.required(editorsService).createEditor('// draft')
      )
      const saved = saving().save(editor)
      await naming().submit(editor, path)
      expect(await saved).toBeUndefined()
      expect(createFile).toHaveBeenCalledWith(source, '// draft')
      expect(editor.src.peek()).toBe(source)
      expect(editor.classification.peek()?.languageId).toBe(language)
      expect(saving().state(editor).peek().dirty).toBe(false)
    }
  )
  it.each([
    { path: 'notes', expected: '/project/notes.md' },
    { path: 'main.kcl', expected: '/project/main.kcl' },
  ])(
    'uses the saving view for "$path" while explicit filename extensions win',
    async ({ path, expected }) => {
      const projects = await namingProject()
      await registry.replace(extra, [
        executorsExtension,
        markdownExtension,
        provide(projectSessionService, projects),
        contribute(editorViewsFacet, () =>
          defineEditorView({
            id: 'modeling',
            label: 'Modeling',
            matches: '.kcl',
            priority: 1000,
            Component: () => null,
          })
        ),
      ])
      const editors = registry.required(editorsService)
      const editor = requireSuccess(editors.createEditor('# Notes'))
      const model = requireSuccess(editors.createView(editor))
      const markdown = requireSuccess(
        editors.createView(editor, 'markdown.preview')
      )
      expect(editors.viewState(model).peek().selected?.id).toBe('modeling')
      naming().focus(editor, markdown.id)
      const saved = saving().save(editor)
      await naming().submit(editor, path)
      expect(await saved).toBeUndefined()
      expect(editor.src.peek()).toBe(expected)
      expect(createFile).toHaveBeenCalledExactlyOnceWith(expected, '# Notes')
    }
  )
  it('uses an explicit extension hint from a mode with predicate matching', async () => {
    const projects = await namingProject()
    await registry.replace(extra, [
      provide(projectSessionService, projects),
      contribute(editorViewsFacet, () =>
        defineEditorView({
          id: 'table',
          label: 'Table',
          matches: () => false,
          defaultExtension: '.csv',
          priority: 1000,
          Component: () => null,
        })
      ),
    ])
    const editors = registry.required(editorsService)
    const editor = requireSuccess(editors.createEditor('a,b'))
    const view = requireSuccess(editors.createView(editor))
    naming().focus(editor, view.id)
    const saved = saving().save(editor)
    await naming().submit(editor, 'table')
    expect(await saved).toBeUndefined()
    expect(editor.src.peek()).toBe('/project/table.csv')
  })
  it('uses an explicitly chosen language when Code has no filename hint', async () => {
    const projects = await namingProject()
    await registry.replace(extra, [
      markdownExtension,
      provide(projectSessionService, projects),
    ])
    const editors = registry.required(editorsService)
    const editor = requireSuccess(editors.createEditor('# Notes'))
    const view = requireSuccess(editors.createView(editor, 'editors.code'))
    requireSuccess(editors.setLanguage(editor.id, 'markdown'))
    naming().focus(editor, view.id)
    const saved = saving().save(editor)
    await naming().submit(editor, 'notes')
    expect(await saved).toBeUndefined()
    expect(editor.src.peek()).toBe('/project/notes.md')
  })
  it('does not overwrite an existing KCL file when the first-save path omits its extension', async () => {
    await namingProject()
    const editor = requireSuccess(
      registry.required(editorsService).createEditor('// draft')
    )
    createFile.mockRejectedValueOnce(new Error('File already exists'))
    const saved = saving().save(editor)
    await naming().submit(editor, 'bracket')
    expect(createFile).toHaveBeenCalledWith('/project/bracket.kcl', '// draft')
    expect(writeFile).not.toHaveBeenCalled()
    expect(editor.src.peek()).toBeUndefined()
    expect(naming().state(editor).peek()?.error).toBe('File already exists')
    naming().cancel(editor)
    await saved
  })
  it('keeps an extensionless destination when renaming an established buffer', async () => {
    await namingProject()
    const editor = open()
    naming().rename(editor)
    await naming().submit(editor, 'notes')
    expect(rename).toHaveBeenCalledWith('/project/notes.txt', '/project/notes')
    expect(editor.src.peek()).toBe('/project/notes')
  })
  it.each([
    '',
    '   ',
    '/outside.txt',
    '../outside.txt',
    '.',
    'folder/',
    'C:\\outside.txt',
  ])(
    'rejects invalid project-relative path %j without writing',
    async (path) => {
      await namingProject()
      const editor = requireSuccess(
        registry.required(editorsService).createEditor('keep me')
      )
      const saved = saving().save(editor)
      await naming().submit(editor, path)
      expect(naming().state(editor).peek()?.error).toBeTruthy()
      expect(editor.src.peek()).toBeUndefined()
      expect(createFile).not.toHaveBeenCalled()
      naming().cancel(editor)
      expect(await saved).toBeUndefined()
      expect(editor.contents.peek()).toBe('keep me')
    }
  )
  it('cancels first Save with Escape and leaves an unnamed dirty buffer', async () => {
    await namingProject()
    const editors = registry.required(editorsService)
    const editor = requireSuccess(editors.createEditor('keep me'))
    editors.createView(editor)
    renderNamingPane()
    let saved!: Promise<undefined | Error>
    act(() => {
      saved = saving().save(editor)
    })
    fireEvent.keyDown(
      screen.getByRole('textbox', { name: 'Project-relative file path' }),
      { key: 'Escape' }
    )
    await act(async () => {
      expect(await saved).toBeUndefined()
    })
    expect(editor.src.peek()).toBeUndefined()
    expect(saving().state(editor).peek().dirty).toBe(true)
    expect(createFile).not.toHaveBeenCalled()
  })
  it('keeps a failed first save unnamed and permits correcting the path', async () => {
    await namingProject()
    const editor = requireSuccess(
      registry.required(editorsService).createEditor('new contents')
    )
    createFile.mockRejectedValueOnce(new Error('File already exists'))
    const saved = saving().save(editor)
    await naming().submit(editor, 'existing.txt')
    expect(naming().state(editor).peek()?.error).toBe('File already exists')
    expect(editor.src.peek()).toBeUndefined()
    expect(writeFile).not.toHaveBeenCalled()
    await naming().submit(editor, 'different.txt')
    expect(await saved).toBeUndefined()
    expect(editor.src.peek()).toBe('/project/different.txt')
  })
  it('renames on double-click without discarding unsaved text or replacing views', async () => {
    await namingProject()
    const editor = open()
    change(editor, 'dirty contents')
    const editors = registry.required(editorsService)
    const view = editors.views.peek()[0]
    renderNamingPane()
    const tab = screen.getByRole('tab', { name: 'notes.txt' })
    fireEvent.doubleClick(tab)
    const input = screen.getByRole('textbox', {
      name: 'Project-relative file path',
    })
    expect(input).toHaveValue('notes.txt')
    fireEvent.change(input, { target: { value: 'renamed.txt' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByRole('tab', { name: 'renamed.txt' })
    expect(rename).toHaveBeenCalledWith(
      '/project/notes.txt',
      '/project/renamed.txt'
    )
    expect(editor.contents.peek()).toBe('dirty contents')
    expect(editors.views.peek()[0]).toBe(view)
    expect(saving().state(editor).peek().dirty).toBe(true)
    await saving().save(editor)
    expect(writeFile).toHaveBeenCalledWith(
      '/project/renamed.txt',
      'dirty contents'
    )
  })
  it('shows a single path input when multiple views share a document', async () => {
    await namingProject()
    const editor = open()
    const editors = registry.required(editorsService)
    editors.createView(editor)
    renderNamingPane()
    fireEvent.doubleClick(screen.getAllByRole('tab', { name: 'notes.txt' })[1])
    expect(
      screen.getAllByRole('textbox', { name: 'Project-relative file path' })
    ).toHaveLength(1)
    expect(
      screen.getByRole('textbox', { name: 'Project-relative file path' })
    ).toHaveFocus()
    await act(async () => {
      await naming().submit(editor, 'shared.txt')
    })
    expect(screen.getAllByRole('tab', { name: 'shared.txt' })).toHaveLength(2)
  })
  it('keeps edits made during first creation and saves the newest text', async () => {
    await namingProject()
    const editor = requireSuccess(
      registry.required(editorsService).createEditor('first snapshot')
    )
    const pending = deferred()
    createFile.mockReturnValueOnce(pending.promise)
    const saved = saving().save(editor)
    const submitted = naming().submit(editor, 'new.txt')
    change(editor, 'newer edits')
    pending.resolve()
    await submitted
    expect(await saved).toBeUndefined()
    expect(createFile).toHaveBeenCalledWith(
      '/project/new.txt',
      'first snapshot'
    )
    expect(writeFile).toHaveBeenCalledWith('/project/new.txt', 'newer edits')
    expect(editor.contents.peek()).toBe('newer edits')
    expect(saving().state(editor).peek().dirty).toBe(false)
  })
  it('cancels the first-save input on blur', async () => {
    await namingProject()
    const editors = registry.required(editorsService)
    const editor = requireSuccess(editors.createEditor('draft'))
    editors.createView(editor)
    renderNamingPane()
    const view = codeSurface(editors, editor)
    act(() => {
      view.focus()
    })
    let saved!: Promise<undefined | Error>
    act(() => {
      saved = saving().save(editor)
    })
    const input = screen.getByRole('textbox', {
      name: 'Project-relative file path',
    })
    expect(input).toHaveFocus()
    await act(async () => {
      input.blur()
    })
    expect(
      screen.queryByRole('textbox', { name: 'Project-relative file path' })
    ).toBeNull()
    await saved
    expect(editor.contents.peek()).toBe('draft')
    expect(createFile).not.toHaveBeenCalled()
  })
  it('waits for existing writes before renaming a source', async () => {
    await namingProject()
    const editor = open()
    const pending = deferred()
    writeFile.mockReturnValueOnce(pending.promise)
    change(editor, 'saved contents')
    const saved = saving().save(editor)
    naming().rename(editor)
    const renamed = naming().submit(editor, 'renamed.txt')
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalled())
    expect(rename).not.toHaveBeenCalled()
    pending.resolve()
    await saved
    await renamed
    expect(editor.src.peek()).toBe('/project/renamed.txt')
    expect(saving().state(editor).peek().dirty).toBe(false)
  })
  it('updates surviving buffers when the buffer that requested a rename closes during IO', async () => {
    await namingProject()
    const editor = open()
    const survivor = open()
    const pending = deferred()
    rename.mockReturnValueOnce(pending.promise)
    naming().rename(editor)
    const submitted = naming().submit(editor, 'renamed.txt')
    await vi.waitFor(() => expect(rename).toHaveBeenCalled())
    registry.required(editorsService).closeEditor(editor.id)
    pending.resolve()
    await submitted
    expect(survivor.src.peek()).toBe('/project/renamed.txt')
    change(survivor, 'surviving edits')
    await saving().save(survivor)
    expect(writeFile).toHaveBeenCalledWith(
      '/project/renamed.txt',
      'surviving edits'
    )
  })
  it('saves to the new source when Save is requested during a rename', async () => {
    await namingProject()
    const editor = open()
    change(editor, 'pending edits')
    const pending = deferred()
    rename.mockReturnValueOnce(pending.promise)
    naming().rename(editor)
    const renamed = naming().submit(editor, 'renamed.txt')
    await vi.waitFor(() => expect(rename).toHaveBeenCalled())
    const saved = saving().save(editor)
    expect(writeFile).not.toHaveBeenCalled()
    pending.resolve()
    await renamed
    expect(await saved).toBeUndefined()
    expect(writeFile).toHaveBeenCalledExactlyOnceWith(
      '/project/renamed.txt',
      'pending edits'
    )
    expect(saving().state(editor).peek().dirty).toBe(false)
  })
  it('allows a queued save to proceed after a failed rename', async () => {
    await namingProject()
    const editor = open()
    change(editor, 'pending edits')
    const pending = deferred()
    rename.mockReturnValueOnce(pending.promise)
    naming().rename(editor)
    const renamed = naming().submit(editor, 'existing.txt')
    await vi.waitFor(() => expect(rename).toHaveBeenCalled())
    const saved = saving().save(editor)
    pending.reject(new Error('Destination exists'))
    await renamed
    expect(await saved).toBeUndefined()
    expect(writeFile).toHaveBeenCalledWith(
      '/project/notes.txt',
      'pending edits'
    )
    expect(saving().state(editor).peek().dirty).toBe(false)
    naming().cancel(editor)
  })
  it('retains the original source and dirty contents when a rename fails', async () => {
    await namingProject()
    const editor = open()
    change(editor, 'dirty contents')
    rename.mockRejectedValueOnce(new Error('Destination exists'))
    naming().rename(editor)
    await naming().submit(editor, 'existing.txt')
    expect(editor.src.peek()).toBe('/project/notes.txt')
    expect(editor.contents.peek()).toBe('dirty contents')
    expect(saving().state(editor).peek().dirty).toBe(true)
    expect(naming().state(editor).peek()?.error).toBe('Destination exists')
    naming().cancel(editor)
  })
  it('does not assign a completed first save to an editor after its project closes', async () => {
    const projects = await namingProject()
    const editor = requireSuccess(
      registry.required(editorsService).createEditor('original')
    )
    const pending = deferred()
    createFile.mockReturnValueOnce(pending.promise)
    const saved = saving().save(editor)
    const submitted = naming().submit(editor, 'new.txt')
    projects.closeProject()
    pending.resolve()
    await submitted
    expect(await saved).toBeInstanceOf(Error)
    expect(editor.src.peek()).toBeUndefined()
    expect(writeFile).not.toHaveBeenCalled()
  })
  it('publishes the editor source and project membership together after confirmed writes', async () => {
    const projects = await namingProject()
    const editor = requireSuccess(
      registry.required(editorsService).createEditor('contents')
    )
    const observed: { source: string | undefined; files: string[] }[] = []
    const stop = projects.currentProject.subscribe(() =>
      observed.push({
        source: editor.src.peek(),
        files: projects.listFiles().map((file) => file.path),
      })
    )
    const saved = saving().save(editor)
    await naming().submit(editor, 'new.md')
    await saved
    naming().rename(editor)
    await naming().submit(editor, 'renamed.md')
    stop()
    expect(observed).toEqual([
      { source: undefined, files: [] },
      { source: '/project/new.md', files: ['/project/new.md'] },
      { source: '/project/renamed.md', files: ['/project/renamed.md'] },
    ])
  })
  it('records a successful creation even if its editor closes while the write is pending', async () => {
    const projects = await namingProject()
    const editors = registry.required(editorsService)
    const editor = requireSuccess(editors.createEditor('saved contents'))
    const pending = deferred()
    createFile.mockReturnValueOnce(pending.promise)
    const saved = saving().save(editor)
    const submitted = naming().submit(editor, 'new.md')
    expect(projects.listFiles()).toEqual([])
    editors.closeEditor(editor.id)
    pending.resolve()
    await submitted
    expect(await saved).toBeInstanceOf(Error)
    expect(projects.listFiles().map((file) => file.path)).toEqual([
      '/project/new.md',
    ])
  })
  it('leaves project membership unchanged when creation or rename fails', async () => {
    const projects = await namingProject()
    const editors = registry.required(editorsService)
    const draft = requireSuccess(editors.createEditor('draft'))
    createFile.mockRejectedValueOnce(new Error('File already exists'))
    const saved = saving().save(draft)
    await naming().submit(draft, 'existing.md')
    expect(projects.listFiles()).toEqual([])
    naming().cancel(draft)
    await saved
    const source = open('/project/kept.md')
    projects.applyFileMutation(projects.currentSession.peek()!, {
      type: 'created',
      path: '/project/kept.md',
    })
    rename.mockRejectedValueOnce(new Error('Rename failed'))
    naming().rename(source)
    await naming().submit(source, 'wrong.md')
    expect(projects.listFiles().map((file) => file.path)).toEqual([
      '/project/kept.md',
    ])
    naming().cancel(source)
  })
  it.each(['tab', 'command'])(
    'selects Markdown preview and lists a newly saved buffer created from the %s',
    async (createFrom) => {
      const root = await mkdtemp(join(tmpdir(), 'zds-first-save-'))
      try {
        createFile.mockImplementation(testFileOperations.createFile)
        writeFile.mockImplementation(testFileOperations.writeFile)
        rename.mockImplementation(testFileOperations.rename)
        const projects = createProjectSessionService(testFileOperations)
        projects.openProject({
          contents: { name: 'project', path: root, children: [] },
          metadata: { title: 'Project', readWriteAccess: true },
        })
        await registry.replace(extra, [
          executorsExtension,
          markdownExtension,
          provide(projectSessionService, projects),
        ])
        renderNamingPane()
        if (createFrom === 'tab')
          fireEvent.click(screen.getByRole('button', { name: 'New editor' }))
        else
          await act(async () => {
            await registry
              .get(commandsFacet)
              .find(({ id }) => id === NEW_EDITOR_COMMAND.id)
              ?.onSubmit()
          })
        const editors = registry.required(editorsService)
        const editor = editors.editors.peek()[0]
        const view = editors.views.peek()[0]
        act(() => {
          change(editor, '# New document')
        })
        expect(
          await screen.findByRole('heading', { name: 'New document' })
        ).toBeVisible()
        expect(editor.src.peek()).toBeUndefined()
        expect(createFile).not.toHaveBeenCalled()
        fireEvent.doubleClick(screen.getByRole('tab', { name: 'Untitled' }))
        const input = screen.getByRole('textbox', {
          name: 'Project-relative file path',
        })
        fireEvent.change(input, { target: { value: 'new.md' } })
        fireEvent.keyDown(input, { key: 'Enter' })
        await screen.findByRole('tab', { name: 'new.md' })
        await screen.findByRole('heading', { name: 'New document' })
        expect(editors.viewState(view).peek().selected?.id).toBe(
          'markdown.preview'
        )
        expect(
          screen.getByRole('button', { name: 'Mode for new.md' })
        ).toBeInTheDocument()
        const arg = registry
          .get(commandsFacet)
          .find(({ id }) => id === OPEN_EDITOR_COMMAND.id)?.args?.src
        if (arg?.inputType !== 'options')
          throw new Error('Expected Open Editor source options')
        const options = () =>
          typeof arg.options === 'function'
            ? arg.options({ argumentsToSubmit: {} })
            : arg.options
        await vi.waitFor(() =>
          expect(options()).toContainEqual({
            name: 'new.md',
            value: join(root, 'new.md'),
          })
        )
        expect(
          new TextDecoder().decode(
            await testFileOperations.readFile(join(root, 'new.md'))
          )
        ).toBe('# New document')
        expect(saving().state(editor).peek().dirty).toBe(false)
        act(() => {
          requireSuccess(editors.setView(view.id, 'editors.code'))
        })
        expect(editors.viewState(view).peek().selected?.id).toBe('editors.code')
        naming().rename(editor)
        await act(async () => {
          await naming().submit(editor, 'renamed.md')
        })
        expect(editors.viewState(view).peek().selected?.id).toBe('editors.code')
        expect(options()).toContainEqual({
          name: 'renamed.md',
          value: join(root, 'renamed.md'),
        })
        expect(options()).not.toContainEqual({
          name: 'new.md',
          value: join(root, 'new.md'),
        })
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  )
  it('supports save behavior without file persistence or a fileOperations service', async () => {
    await registry.configure([editorsExtension, saveExtension, extra])
    const editor = open()
    change(editor, 'save elsewhere')
    const missing = await saving().save(editor)
    expect(missing).toBeInstanceOf(Error)
    expect(saving().state(editor).value).toMatchObject({
      dirty: true,
      error: missing,
    })
    const commit = vi.fn(async () => undefined)
    await registry.replace(extra, [
      [
        contribute(editorOnSaveFacet, () => ({
          id: 'test.customSave',
          matches: '*' as const,
          onSave: commit,
        })),
      ],
    ])
    expect(await saving().save(editor)).toBeUndefined()
    expect(commit).toHaveBeenCalledWith({
      editor,
      src: editor.src.peek(),
      contents: 'save elsewhere',
    })
    expect(saving().state(editor).value.dirty).toBe(false)
    expect(writeFile).not.toHaveBeenCalled()
  })
  it('runs matching hooks only after a successful write, using the saved snapshot rather than later typing', async () => {
    const saved = vi.fn()
    const unrelated = vi.fn()
    await registry.replace(extra, [
      [
        contribute(editorOnSaveFacet, () => ({
          id: 'test.saved',
          matches: ({ contents }) => contents === 'to save',
          onSave: saved,
        })),
        contribute(editorOnSaveFacet, () => ({
          id: 'test.other',
          matches: '.md' as const,
          onSave: unrelated,
        })),
      ],
    ])
    const editor = open()
    change(editor, 'to save')
    const pending = deferred()
    writeFile.mockReturnValueOnce(pending.promise)
    const result = saving().save(editor)
    await Promise.resolve()
    expect(saved).not.toHaveBeenCalled()
    change(editor, 'typed during save')
    pending.resolve()
    await result
    expect(saved).toHaveBeenCalledWith({
      editor,
      src: editor.src.peek(),
      contents: 'to save',
    })
    expect(unrelated).not.toHaveBeenCalled()
    saved.mockClear()
    change(editor, 'to save')
    writeFile.mockRejectedValueOnce(new Error('Disk unavailable'))
    expect(await saving().save(editor)).toBeInstanceOf(Error)
    expect(saved).not.toHaveBeenCalled()
  })
  it('orders handlers explicitly and stops on failure without completing the save', async () => {
    const other = vi.fn()
    const failure = new Error('Metadata could not be applied')
    await registry.replace(extra, [
      [
        contribute(editorOnSaveFacet, () => ({
          id: 'test.other',
          order: 20,
          matches: '*' as const,
          onSave: other,
        })),
        contribute(editorOnSaveFacet, () => ({
          id: 'test.failure',
          order: 10,
          matches: '*' as const,
          onSave: () => failure,
        })),
      ],
    ])
    const editor = open()
    change(editor, 'updated')
    const result = await saving().save(editor)
    expect(result).toBe(failure)
    expect(writeFile).toHaveBeenCalledWith(editor.src.peek(), 'updated')
    expect(other).not.toHaveBeenCalled()
    expect(saving().state(editor).value).toMatchObject({
      dirty: true,
      saving: false,
      error: result,
    })
  })
  it('clears dirty on undo and saves a snapshot while subsequent typing stays dirty', async () => {
    const editor = open()
    const state = saving().state(editor)
    change(editor, 'changed')
    expect(state.value.dirty).toBe(true)
    editor.undo()
    expect(state.value.dirty).toBe(false)
    change(editor, 'to save')
    const pending = deferred()
    writeFile.mockReturnValueOnce(pending.promise)
    const save = saving().save(editor)
    await Promise.resolve()
    expect(writeFile).toHaveBeenCalledWith(editor.src.peek(), 'to save')
    change(editor, 'typed during save')
    expect(state.value.saving).toBe(true)
    pending.resolve()
    await save
    expect(state.value).toMatchObject({
      dirty: true,
      saving: false,
    })
    change(editor, 'to save')
    expect(state.value.dirty).toBe(false)
  })
  it('keeps failures dirty and exposes a recoverable error', async () => {
    const editor = open()
    change(editor, 'changed')
    const error = new Error('Disk full')
    writeFile.mockRejectedValueOnce(error)
    expect(await saving().save(editor)).toBe(error)
    expect(saving().state(editor).value).toMatchObject({
      dirty: true,
      saving: false,
      error,
    })
    await saving().save(editor)
    expect(saving().state(editor).value).toEqual({
      dirty: false,
      saving: false,
      error: undefined,
    })
  })
  it('orders saves to one path and updates other buffers against the actual disk baseline', async () => {
    const first = open(),
      second = open()
    change(first, 'first')
    change(second, 'second')
    const pending = deferred()
    writeFile.mockReturnValueOnce(pending.promise)
    const one = saving().save(first),
      two = saving().save(second)
    await Promise.resolve()
    expect(writeFile).toHaveBeenCalledTimes(1)
    pending.resolve()
    await Promise.all([one, two])
    expect(writeFile.mock.calls.map(([, contents]) => contents)).toEqual([
      'first',
      'second',
    ])
    expect(saving().state(first).value.dirty).toBe(true)
    expect(saving().state(second).value.dirty).toBe(false)
  })
  it.each(['same buffer', 'another buffer'])(
    'discards saves queued before remote adoption in %s',
    async (target) => {
      const editor = open()
      const adopted = target === 'same buffer' ? editor : open()
      const pending = deferred()
      writeFile.mockReturnValueOnce(pending.promise)
      change(editor, 'first local edit')
      const first = saving().save(editor)
      await Promise.resolve()
      change(editor, 'queued local edit')
      const queued = saving().save(editor)
      change(adopted, 'remote contents')
      expect(saving().adopt(adopted, 'remote contents')).toBeUndefined()
      pending.resolve()
      await Promise.all([first, queued])
      expect(writeFile.mock.calls.map(([, contents]) => contents)).toEqual([
        'first local edit',
      ])
      expect(saving().state(adopted).peek()).toMatchObject({
        dirty: false,
        saving: false,
        error: undefined,
      })
      expect(saving().state(editor).peek().saving).toBe(false)
      change(adopted, 'edit after adoption')
      expect(await saving().save(adopted)).toBeUndefined()
      expect(writeFile).toHaveBeenLastCalledWith(
        adopted.src.peek(),
        'edit after adoption'
      )
      expect(saving().state(adopted).peek().dirty).toBe(false)
    }
  )
  it('preserves the remote baseline adopted by another buffer during a save', async () => {
    const editor = open(),
      adopted = open()
    const pending = deferred()
    writeFile.mockReturnValueOnce(pending.promise)
    change(editor, 'local edit')
    const saved = saving().save(editor)
    await Promise.resolve()
    change(adopted, 'remote contents')
    expect(saving().adopt(adopted, 'remote contents')).toBeUndefined()
    pending.resolve()
    expect(await saved).toBeUndefined()
    expect(adopted.contents.peek()).toBe('remote contents')
    expect(saving().state(adopted).peek().dirty).toBe(false)
    expect(saving().state(editor).peek()).toMatchObject({
      dirty: true,
      saving: false,
    })
  })
  it('skips queued saves for closed or reassociated buffers', async () => {
    const first = open(),
      closed = open(),
      renamed = open()
    const pending = deferred()
    writeFile.mockReturnValueOnce(pending.promise)
    const saves = [first, closed, renamed].map((editor) =>
      saving().save(editor)
    )
    registry.required(editorsService).closeEditor(closed.id)
    registry
      .required(editorsService)
      .setSource(renamed.id, '/project/other.txt')
    pending.resolve()
    const results = await Promise.all(saves)
    expect(results.slice(1).every((result) => result instanceof Error)).toBe(
      true
    )
    expect(writeFile).toHaveBeenCalledTimes(1)
  })
  it('stops queued writes when its registry lifetime ends', async () => {
    const first = open(),
      second = open()
    const persistenceService = saving()
    const pending = deferred()
    writeFile.mockReturnValueOnce(pending.promise)
    const one = persistenceService.save(first),
      two = persistenceService.save(second)
    await Promise.resolve()
    await registry.dispose()
    pending.resolve()
    await one
    expect(await two).toBeInstanceOf(Error)
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(await persistenceService.save(first)).toBeInstanceOf(Error)
  })
  it('preserves the saved baseline when capabilities change and cleans up on close', async () => {
    const editor = open()
    change(editor, 'changed')
    await registry.replace(extra, [
      [
        contribute(editorCapabilityFacet, () => ({
          id: 'extra',
          matches: '*' as const,
          setup: () => {},
        })),
      ],
    ])
    expect(saving().state(editor).value.dirty).toBe(true)
    registry
      .required(editorsService)
      .setSource(editor.id, '/project/renamed.md')
    await saving().save(editor)
    expect(writeFile).toHaveBeenCalledWith('/project/renamed.md', 'changed')
    registry.required(editorsService).closeEditor(editor.id)
    expect(await saving().save(editor)).toBeInstanceOf(Error)
  })
  it('shows contributed indicators independently and saves the focused buffer with the command', async () => {
    const first = open(),
      second = open('/project/other.md')
    const indicators = registry.observe(editorTabIndicatorsFacet)
    const layout = {
      id: 'editors',
      label: 'Editors',
      type: LayoutType.Simple,
      areaType: 'editors',
    } as const
    render(
      <EditorsPane
        editors={registry.required(editorsService)}
        indicators={indicators}
        layout={layout}
      />
    )
    expect(
      screen.queryByRole('img', {
        name: 'Unsaved changes',
      })
    ).not.toBeInTheDocument()
    await act(async () => {
      change(first, 'save first')
    })
    expect(
      screen.getByRole('tab', {
        name: /notes.txt/,
      })
    ).toContainElement(
      screen.getByRole('img', {
        name: 'Unsaved changes',
      })
    )
    await act(async () => {
      fireEvent.click(
        screen.getByRole('tab', {
          name: /notes.txt/,
        })
      )
      codeSurface(registry.required(editorsService), first).focus()
      await saving().save(first)
    })
    expect(writeFile).toHaveBeenCalledWith(first.src.peek(), 'save first')
    expect(
      screen.queryByRole('img', {
        name: 'Unsaved changes',
      })
    ).not.toBeInTheDocument()
    expect(
      codeSurface(
        registry.required(editorsService),
        second
      ).state.doc.toString()
    ).toBe('original')
    await act(async () => {
      change(first, 'save via command')
      codeSurface(registry.required(editorsService), first).contentDOM.blur()
      const command = registry
        .get(commandsFacet)
        .find(({ id }) => id === SAVE_EDITOR_COMMAND.id)!
      await command.onSubmit?.()
    })
    expect(writeFile).toHaveBeenLastCalledWith(
      first.src.peek(),
      'save via command'
    )
    // A second extension can decorate the same tab without knowing about saving.
    await act(async () => {
      await registry.replace(extra, [
        [
          contribute(editorTabIndicatorsFacet, () => ({
            id: 'test.notice',
            component: () => <span title="Independent indicator">!</span>,
          })),
        ],
      ])
      change(first, 'unsaved again')
    })
    expect(screen.getAllByTitle('Independent indicator')).toHaveLength(2)
    expect(
      screen.getByRole('img', {
        name: 'Unsaved changes',
      })
    ).toBeVisible()
  })
})
