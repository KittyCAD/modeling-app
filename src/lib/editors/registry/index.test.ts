import { undo } from '@codemirror/commands'
import { language } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import {
  defineRegistryItem,
  provide,
  provideService,
  Registry,
  Slot,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { OPEN_EDITOR_COMMAND } from '@src/lib/editors/commands'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import projectSessionNextExtension from '@src/lib/projectSession/registry'
import {
  editorCapabilityValueSpec,
  editorsService,
  type EditorCapability,
} from '@src/lib/editors/registry/contract'
import editorsExtension from '@src/lib/editors/registry'
import kclExtension from '@src/lib/kcl/registry'
import markdownExtension from '@src/lib/markdown/registry'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

describe('editors extension', () => {
  let registry: Registry
  const readFile = vi.fn<(src: string) => Promise<Uint8Array>>()
  beforeAll(async () => {
    await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  })
  beforeEach(() => {
    readFile
      .mockReset()
      .mockResolvedValue(new TextEncoder().encode('file contents'))
    registry = new Registry()
    registry.configure([
      editorsExtension,
      kclExtension,
      markdownExtension,
      projectSessionNextExtension,
      defineRegistryItem({
        providesServices: [
          provideService(fileOperationsService, {
            ...testFileOperations,
            readFile,
          }),
        ],
      }),
    ])
  })
  afterEach(() => {
    registry[Symbol.dispose]()
  })

  const openCommand = () =>
    registry
      .get(commandsValueSpec)
      .find(({ id }) => id === OPEN_EDITOR_COMMAND.id)!
  const sourceOptions = () => {
    const arg = openCommand().args?.src
    if (arg?.inputType !== 'options') throw new Error('Expected source options')
    return typeof arg.options === 'function'
      ? arg.options({ argumentsToSubmit: {} })
      : arg.options
  }

  const selectProject = (path = '/project') =>
    registry.get(projectSessionService).openProject({
      contents: {
        name: 'project',
        path,
        children: [
          { name: 'main.kcl', path: `${path}/main.kcl`, children: null },
          { name: 'notes.md', path: `${path}/notes.md`, children: null },
        ],
      },
      metadata: { title: 'Project', readWriteAccess: true },
    })

  it('creates a fully populated view synchronously without reading storage', () => {
    const service = registry.get(editorsService)
    const editor = service.openEditor('/main.kcl', 'initial contents')
    expect(editor.view.state.doc.toString()).toBe('initial contents')
    expect(service.editors.value).toEqual([editor])
    expect(readFile).not.toHaveBeenCalled()
  })

  it('tracks independent editor instances for the same source', () => {
    const service = registry.get(editorsService)
    const src = '/projects/bracket/main.kcl'
    const first = service.openEditor(src, '')
    const second = service.openEditor(src, '')
    expect(first.id).not.toBe(second.id)
    expect(service.editors.value).toEqual([first, second])
    service.closeEditor(first.id)
    expect(service.editors.value).toEqual([second])
    service.closeEditor(second.id)
    expect(service.editors.value).toEqual([])
  })

  it('clears editor state when the registry is disposed', () => {
    const service = registry.get(editorsService)
    service.openEditor('/main.kcl', '')
    registry[Symbol.dispose]()
    expect(service.editors.value).toEqual([])
  })

  it('registers an open-editor command that loads contents into independent views', async () => {
    registry.get(projectSessionService).openProject({
      contents: {
        name: 'project',
        path: 'cloud:project',
        children: [
          {
            name: 'main.kcl',
            path: 'cloud:project/parts/main.kcl',
            children: null,
          },
        ],
      },
      metadata: { title: 'Project', readWriteAccess: true },
    })
    const command = registry
      .get(commandsValueSpec)
      .find(({ id }) => id === OPEN_EDITOR_COMMAND.id)
    expect(command).toMatchObject({ args: { src: { inputType: 'options' } } })
    const src = 'cloud:project/parts/main.kcl'
    const pending = command!.onSubmit({ src })
    expect(registry.get(editorsService).editors.value).toEqual([])
    await pending
    await command!.onSubmit({ src })
    const [first, second] = registry.get(editorsService).editors.value
    expect(first.src.value).toBe(src)
    expect(second.src.value).toBe(src)
    expect(first.id).not.toBe(second.id)
    expect(first.view.state.doc.toString()).toBe('file contents')
    expect(second.view.state.doc.toString()).toBe('file contents')
    expect(readFile.mock.calls).toEqual([[src], [src]])
  })

  it('uses the project service to list every file with relative names, including binary formats', async () => {
    const file = (path: string) => ({
      name: path,
      path: `/project/${path}`,
      children: null,
    })
    const sessions = registry.get(projectSessionService)
    sessions.openProject({
      contents: {
        name: 'project',
        path: '/project',
        children: [
          file('main.kcl'),
          file('README'),
          file('config.TOML'),
          file('.env.local'),
          file('photo.png'),
          file('model.glb'),
          file('archive.zip'),
          {
            name: 'parts',
            path: '/project/parts',
            children: [
              {
                name: 'main.kcl',
                path: '/project/parts/main.kcl',
                children: null,
              },
              {
                name: 'notes.md',
                path: '/project/parts/notes.md',
                children: null,
              },
            ],
          },
          { name: 'folder.txt', path: '/project/folder.txt', children: [] },
        ],
      },
      metadata: { title: 'Project', readWriteAccess: true },
    })
    const options = sourceOptions()
    expect(options.map(({ name }) => name)).toEqual([
      '.env.local',
      'archive.zip',
      'config.TOML',
      'main.kcl',
      'model.glb',
      'parts/main.kcl',
      'parts/notes.md',
      'photo.png',
      'README',
    ])
    expect(options.find(({ name }) => name === 'parts/main.kcl')?.value).toBe(
      '/project/parts/main.kcl'
    )
    expect(readFile).not.toHaveBeenCalled()
    await openCommand().onSubmit({ src: '/project/photo.png' })
    expect(registry.get(editorsService).editors.value[0].src.value).toBe(
      '/project/photo.png'
    )
  })

  it('refreshes source options after project updates and refuses stale selections', async () => {
    const sessions = registry.get(projectSessionService)
    const project = (path: string) => ({
      contents: {
        name: path,
        path,
        children: [
          { name: 'main.kcl', path: `${path}/main.kcl`, children: null },
        ],
      },
      metadata: { title: path, readWriteAccess: true },
    })
    const first = sessions.openProject(project('/first'))
    const command = openCommand()
    expect(sourceOptions()).toEqual([
      { name: 'main.kcl', value: '/first/main.kcl' },
    ])
    sessions.openProject({
      ...first.project.value,
      contents: { ...first.project.value.contents, children: [] },
    })
    expect(sourceOptions()).toEqual([])
    sessions.openProject(project('/second'))
    expect(sourceOptions()).toEqual([
      { name: 'main.kcl', value: '/second/main.kcl' },
    ])
    await expect(
      command.onSubmit({ src: '/first/main.kcl' })
    ).resolves.toBeInstanceOf(Error)
    expect(readFile).not.toHaveBeenCalled()
    sessions.closeProject()
    expect(sourceOptions()).toEqual([])
  })

  it('offers no sources when the project session service is absent', () => {
    registry.configure([editorsExtension, markdownExtension])
    expect(sourceOptions()).toEqual([])
  })

  it.each([{ src: 42 }, { src: '   ' }])(
    'does not open an editor for an invalid command source: %j',
    async (data) => {
      const command = registry
        .get(commandsValueSpec)
        .find(({ id }) => id === OPEN_EDITOR_COMMAND.id)!
      await expect(command.onSubmit(data)).resolves.toBeInstanceOf(Error)
      expect(readFile).not.toHaveBeenCalled()
      expect(registry.get(editorsService).editors.value).toEqual([])
    }
  )

  it('opens an empty file', async () => {
    selectProject()
    readFile.mockResolvedValueOnce(new Uint8Array())
    await openCommand().onSubmit({ src: '/project/main.kcl' })
    expect(
      registry.get(editorsService).editors.value[0].view.state.doc.toString()
    ).toBe('')
  })

  it('returns read failures without registering an editor', async () => {
    selectProject()
    const failure = new Error('File is unreadable')
    readFile.mockRejectedValueOnce(failure)
    await expect(
      openCommand().onSubmit({ src: '/project/main.kcl' })
    ).resolves.toBe(failure)
    expect(registry.get(editorsService).editors.value).toEqual([])
  })

  it.each(['switch', 'close', 'dispose'] as const)(
    'discards an in-flight read after project %s',
    async (action) => {
      selectProject()
      const editors = registry.get(editorsService)
      const pendingRead = Promise.withResolvers<Uint8Array>()
      readFile.mockReturnValueOnce(pendingRead.promise)
      const pendingOpen = openCommand().onSubmit({ src: '/project/main.kcl' })
      if (action === 'switch') selectProject('/other')
      else if (action === 'close')
        registry.get(projectSessionService).closeProject()
      else registry[Symbol.dispose]()
      pendingRead.resolve(new TextEncoder().encode('late contents'))
      await expect(pendingOpen).resolves.toBeInstanceOf(Error)
      expect(editors.editors.value).toEqual([])
    }
  )

  it('keeps concurrent reads bound to their own source and contents', async () => {
    selectProject()
    const first = Promise.withResolvers<Uint8Array>()
    const second = Promise.withResolvers<Uint8Array>()
    readFile
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const command = openCommand()
    const openFirst = command.onSubmit({ src: '/project/main.kcl' })
    const openSecond = command.onSubmit({ src: '/project/notes.md' })
    second.resolve(new TextEncoder().encode('second contents'))
    await openSecond
    first.resolve(new TextEncoder().encode('first contents'))
    await openFirst
    expect(
      registry.get(editorsService).editors.value.map(({ src, view }) => ({
        src: src.value,
        contents: view.state.doc.toString(),
      }))
    ).toEqual([
      { src: '/project/notes.md', contents: 'second contents' },
      { src: '/project/main.kcl', contents: 'first contents' },
    ])
  })

  it.each([
    ['/projects/bracket/main.kcl', true],
    ['cloud:project-id/parts/main.KCL', true],
    ['C:\\projects\\bracket\\main.kcl', true],
    ['/projects/main.kcl/README', false],
    ['/projects/bracket/.kcl', false],
    ['/projects/bracket/notes.md', false],
  ])('applies only matching and wildcard capabilities to %s', (src, isKcl) => {
    registry.configure([
      editorsExtension,
      kclExtension,
      markdownExtension,
      defineRegistryItem({
        provides: [
          provide(editorCapabilityValueSpec, {
            id: 'common.tab-size',
            editorType: '*',
            capabilities: EditorState.tabSize.of(2),
          }),
          provide(editorCapabilityValueSpec, {
            id: 'kcl.read-only',
            editorType: '.kcl',
            capabilities: EditorState.readOnly.of(true),
          }),
        ],
      }),
    ])
    const editor = registry.get(editorsService).openEditor(src, '')
    expect(editor.view.state.tabSize).toBe(2)
    expect(editor.view.state.readOnly).toBe(isKcl)
  })

  it('reconfigures live contributions without losing edits, selection or history', () => {
    const slot = new Slot()
    const readOnly = (editorType: '.kcl' | '.md' | '*') =>
      defineRegistryItem({
        provides: [
          provide(editorCapabilityValueSpec, {
            id: 'read-only',
            editorType,
            capabilities: EditorState.readOnly.of(true),
          }),
        ],
      })
    registry.configure([editorsExtension, markdownExtension, slot.of()])
    const service = registry.get(editorsService)
    const first = service.openEditor('/main.kcl', '')
    const second = service.openEditor('/main.kcl', '')
    const markdown = service.openEditor('cloud:project/notes.md', '')
    const view = first.view
    view.dispatch({
      changes: { from: 0, insert: 'hello' },
      selection: { anchor: 3 },
    })
    const dispatch = vi.spyOn(view, 'dispatch')

    registry.reconfigure(slot, [readOnly('.md')])
    expect(markdown.view.state.readOnly).toBe(true)
    expect(view.state.readOnly).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()

    registry.reconfigure(slot, [readOnly('.kcl')])
    expect(markdown.view.state.readOnly).toBe(false)
    expect(view.state.readOnly).toBe(true)
    expect(second.view.state.readOnly).toBe(true)
    expect(second.view.state.doc.toString()).toBe('')
    expect(service.editors.value[0]).toBe(first)
    expect(first.view).toBe(view)
    expect(view.state.doc.toString()).toBe('hello')
    expect(view.state.selection.main.anchor).toBe(3)

    registry.reconfigure(slot, [readOnly('*')])
    expect(markdown.view.state.readOnly).toBe(true)
    registry.reconfigure(slot, [])
    expect(markdown.view.state.readOnly).toBe(false)
    expect(view.state.readOnly).toBe(false)
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('')
  })

  it('derives file type from renamed sources and preserves the view, contents, and history', () => {
    const service = registry.get(editorsService)
    const editor = service.openEditor('/notes.MD', '# Heading')
    const view = editor.view
    expect(view.state.facet(language)?.name).toBe('markdown')
    const sources: string[] = []
    const types: string[] = []
    const stopSource = editor.src.subscribe((src) => sources.push(src))
    const stopType = editor.type.subscribe((type) => types.push(type))
    view.dispatch({
      changes: { from: 0, insert: 'prefix ' },
      selection: { anchor: 3 },
    })
    service.setSource(editor.id, '/parts/model.KCL')
    expect(editor.src.value).toBe('/parts/model.KCL')
    expect(editor.type.value).toBe('.kcl')
    expect(view.state.facet(language)?.name).toBe('kcl')
    expect(editor.view).toBe(view)
    expect(view.state.doc.toString()).toBe('prefix # Heading')
    expect(view.state.selection.main.anchor).toBe(3)
    service.setSource(editor.id, '/moved/model.kcl')
    expect(sources).toEqual([
      '/notes.MD',
      '/parts/model.KCL',
      '/moved/model.kcl',
    ])
    expect(types).toEqual(['.md', '.kcl'])
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('# Heading')
    service.setSource(editor.id, '/README')
    expect(editor.type.value).toBe('')
    service.closeEditor(editor.id)
    service.setSource(editor.id, '/closed.md')
    expect(editor.src.value).toBe('/README')
    stopSource()
    stopType()
  })

  it('destroys closed views and stops updating them on registry changes', () => {
    const slot = new Slot()
    registry.configure([editorsExtension, markdownExtension, slot.of()])
    const service = registry.get(editorsService)
    const closed = service.openEditor('/main.kcl', '')
    const open = service.openEditor('/main.kcl', '')
    const closedDestroy = vi.spyOn(closed.view, 'destroy')
    const openDestroy = vi.spyOn(open.view, 'destroy')
    const closedDispatch = vi.spyOn(closed.view, 'dispatch')
    service.closeEditor(closed.id)
    service.closeEditor(closed.id)
    expect(closedDestroy).toHaveBeenCalledOnce()

    registry.reconfigure(slot, [
      defineRegistryItem({
        provides: [
          provide(editorCapabilityValueSpec, {
            id: 'common.tab-size',
            editorType: '*',
            capabilities: EditorState.tabSize.of(2),
          }),
        ],
      }),
    ])
    expect(closedDispatch).not.toHaveBeenCalled()
    expect(open.view.state.tabSize).toBe(2)
    registry[Symbol.dispose]()
    expect(closedDestroy).toHaveBeenCalledOnce()
    expect(openDestroy).toHaveBeenCalledOnce()
    expect(service.editors.value).toEqual([])
  })

  it('updates a registered capability when its contributed signal changes', () => {
    const capability = signal<EditorCapability>({
      id: 'tab-size',
      editorType: '.kcl',
      capabilities: EditorState.tabSize.of(2),
    })
    registry.configure([
      editorsExtension,
      kclExtension,
      markdownExtension,
      defineRegistryItem({
        provides: [provide(editorCapabilityValueSpec, capability)],
      }),
    ])
    const editor = registry.get(editorsService).openEditor('/main.kcl', '')
    expect(editor.view.state.tabSize).toBe(2)
    capability.value = {
      ...capability.value,
      capabilities: EditorState.tabSize.of(6),
    }
    expect(editor.view.state.tabSize).toBe(6)
    capability.value = { ...capability.value, editorType: '.md' }
    expect(editor.view.state.tabSize).toBe(4)
  })
})
