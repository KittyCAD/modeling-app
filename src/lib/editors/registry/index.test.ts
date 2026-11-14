import '@src/lib/projectSession/next/testFeature'
import {
  requireSuccess,
  codeSurface,
  presentation,
} from '@src/lib/editors/testViews'
import { language } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import {
  factory as defineFactory,
  Registry,
  provide,
  contribute,
  slot as createSlot,
  type InputOf,
} from 'plankton'
import { signal } from '@preact/signals-core'
import {
  OPEN_EDITOR_COMMAND,
  NEW_EDITOR_COMMAND,
} from '@src/lib/editors/commands'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { commandsFacet } from '@src/registry/contracts/commands'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { createProjectSessionExtension } from '@src/lib/projectSession/registry'
import {
  editorCapabilityFacet,
  codeEditorsExtensionFacet,
  editorsService,
  type CodeEditorExtension,
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
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
describe('editors extension', () => {
  let registry: Registry
  const readFile = vi.fn<(src: string) => Promise<Uint8Array>>()
  beforeAll(async () => {
    await moduleFsViaModuleImport({
      type: StorageName.NodeFS,
      options: {},
    })
  })
  beforeEach(async () => {
    readFile
      .mockReset()
      .mockResolvedValue(new TextEncoder().encode('file contents'))
    registry = new Registry()
    await registry.configure([
      editorsExtension,
      kclExtension,
      markdownExtension,
      createProjectSessionExtension(
        defineFactory({
          create: () => {
            const operations = { ...testFileOperations, readFile }
            return {
              exports: { operations },
              items: [provide(fileOperationsService, operations)],
            }
          },
        })
      ),
    ])
  })
  afterEach(async () => {
    await registry.dispose()
  })
  const openCommand = () =>
    registry.get(commandsFacet).find(({ id }) => id === OPEN_EDITOR_COMMAND.id)!
  const sourceOptions = () => {
    const arg = openCommand().args?.src
    if (arg?.inputType !== 'options') throw new Error('Expected source options')
    return typeof arg.options === 'function'
      ? arg.options({
          argumentsToSubmit: {},
        })
      : arg.options
  }
  const selectProject = (path = '/project') =>
    registry.required(projectSessionService).openProject({
      contents: {
        name: 'project',
        path,
        children: [
          {
            name: 'main.kcl',
            path: `${path}/main.kcl`,
            children: null,
          },
          {
            name: 'notes.md',
            path: `${path}/notes.md`,
            children: null,
          },
        ],
      },
      metadata: {
        title: 'Project',
        readWriteAccess: true,
      },
    })
  it('creates a fully populated view synchronously without reading storage', () => {
    const service = registry.required(editorsService)
    const editor = requireSuccess(
      service.openEditor('/main.kcl', 'initial contents')
    )
    expect(
      codeSurface(
        registry.required(editorsService),
        editor
      ).state.doc.toString()
    ).toBe('initial contents')
    expect(service.editors.value).toEqual([editor])
    expect(readFile).not.toHaveBeenCalled()
  })
  it('tracks independent editor instances for the same source', () => {
    const service = registry.required(editorsService)
    const src = '/projects/bracket/main.kcl'
    const first = requireSuccess(service.openEditor(src, ''))
    const second = requireSuccess(service.openEditor(src, ''))
    expect(first.id).not.toBe(second.id)
    expect(service.editors.value).toEqual([first, second])
    service.closeEditor(first.id)
    expect(service.editors.value).toEqual([second])
    service.closeEditor(second.id)
    expect(service.editors.value).toEqual([])
  })
  it('opens another presentation of the current buffer without rereading disk', async () => {
    registry.required(projectSessionService).openProject({
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
      metadata: {
        title: 'Project',
        readWriteAccess: true,
      },
    })
    const command = registry
      .get(commandsFacet)
      .find(({ id }) => id === OPEN_EDITOR_COMMAND.id)
    const src = 'cloud:project/parts/main.kcl'
    const pending = command!.onSubmit({
      src,
    })
    expect(registry.required(editorsService).editors.value).toEqual([])
    await pending
    await command!.onSubmit({
      src,
    })
    const service = registry.required(editorsService)
    const [editor] = service.editors.value
    expect(service.editors.value).toHaveLength(1)
    expect(editor.src.value).toBe(src)
    expect(service.views.value).toHaveLength(2)
    expect(service.views.value.every((view) => view.editor === editor)).toBe(
      true
    )
    expect(readFile).toHaveBeenCalledTimes(1)
  })
  it('uses the project service to list every file with relative names, including binary formats', async () => {
    const file = (path: string) => ({
      name: path,
      path: `/project/${path}`,
      children: null,
    })
    const sessions = registry.required(projectSessionService)
    sessions.openProject({
      contents: {
        name: 'project',
        path: '/project',
        children: [
          file('README'),
          file('photo.png'),
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
          {
            name: 'folder.txt',
            path: '/project/folder.txt',
            children: [],
          },
        ],
      },
      metadata: {
        title: 'Project',
        readWriteAccess: true,
      },
    })
    const options = sourceOptions()
    expect(options.map(({ name }) => name)).toEqual([
      'parts/main.kcl',
      'parts/notes.md',
      'photo.png',
      'README',
    ])
    expect(options.find(({ name }) => name === 'parts/main.kcl')?.value).toBe(
      '/project/parts/main.kcl'
    )
    expect(readFile).not.toHaveBeenCalled()
    await openCommand().onSubmit({
      src: '/project/photo.png',
    })
    expect(registry.required(editorsService).editors.value[0].src.value).toBe(
      '/project/photo.png'
    )
  })
  it('refreshes source options after project updates and refuses stale selections', async () => {
    const sessions = registry.required(projectSessionService)
    const project = (path: string) => ({
      contents: {
        name: path,
        path,
        children: [
          {
            name: 'main.kcl',
            path: `${path}/main.kcl`,
            children: null,
          },
        ],
      },
      metadata: {
        title: path,
        readWriteAccess: true,
      },
    })
    const first = sessions.openProject(project('/first'))
    const command = openCommand()
    expect(sourceOptions()).toEqual([
      {
        name: 'main.kcl',
        value: '/first/main.kcl',
      },
    ])
    sessions.openProject({
      ...first.project.value,
      contents: {
        ...first.project.value.contents,
        children: [],
      },
    })
    expect(sourceOptions()).toEqual([])
    sessions.openProject(project('/second'))
    expect(sourceOptions()).toEqual([
      {
        name: 'main.kcl',
        value: '/second/main.kcl',
      },
    ])
    await expect(
      command.onSubmit({
        src: '/first/main.kcl',
      })
    ).resolves.toBeInstanceOf(Error)
    expect(readFile).not.toHaveBeenCalled()
    sessions.closeProject()
    expect(sourceOptions()).toEqual([])
  })
  it('offers no sources when the project session service is absent', async () => {
    await registry.configure([editorsExtension, markdownExtension])
    expect(sourceOptions()).toEqual([])
  })
  it.each([
    {
      src: 42,
    },
    {
      src: '   ',
    },
  ])(
    'does not open an editor for an invalid command source: %j',
    async (data) => {
      const command = registry
        .get(commandsFacet)
        .find(({ id }) => id === OPEN_EDITOR_COMMAND.id)!
      await expect(command.onSubmit(data)).resolves.toBeInstanceOf(Error)
      expect(readFile).not.toHaveBeenCalled()
      expect(registry.required(editorsService).editors.value).toEqual([])
    }
  )
  it('opens an empty file', async () => {
    selectProject()
    readFile.mockResolvedValueOnce(new Uint8Array())
    await openCommand().onSubmit({
      src: '/project/main.kcl',
    })
    expect(
      registry.required(editorsService).editors.value[0].contents.value
    ).toBe('')
  })
  it('returns read failures without registering an editor', async () => {
    selectProject()
    const failure = new Error('File is unreadable')
    readFile.mockRejectedValueOnce(failure)
    await expect(
      openCommand().onSubmit({
        src: '/project/main.kcl',
      })
    ).resolves.toBe(failure)
    expect(registry.required(editorsService).editors.value).toEqual([])
  })
  it.each(['switch', 'close', 'dispose'] as const)(
    'discards an in-flight read after project %s',
    async (action) => {
      selectProject()
      const editors = registry.required(editorsService)
      const pendingRead = Promise.withResolvers<Uint8Array>()
      readFile.mockReturnValueOnce(pendingRead.promise)
      const pendingOpen = openCommand().onSubmit({
        src: '/project/main.kcl',
      })
      if (action === 'switch') selectProject('/other')
      else if (action === 'close')
        registry.required(projectSessionService).closeProject()
      else await registry.dispose()
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
    const openFirst = command.onSubmit({
      src: '/project/main.kcl',
    })
    const openSecond = command.onSubmit({
      src: '/project/notes.md',
    })
    second.resolve(new TextEncoder().encode('second contents'))
    await openSecond
    first.resolve(new TextEncoder().encode('first contents'))
    await openFirst
    expect(
      registry
        .required(editorsService)
        .editors.value.map(({ src, contents }) => ({
          src: src.value,
          contents: contents.value,
        }))
    ).toEqual([
      {
        src: '/project/notes.md',
        contents: 'second contents',
      },
      {
        src: '/project/main.kcl',
        contents: 'first contents',
      },
    ])
  })
  it.each([
    ['/main.kcl', true],
    ['/notes.md', false],
  ])(
    'applies only matching and wildcard capabilities to %s',
    async (src, isKcl) => {
      const _codeEditorsExtensionContribution: InputOf<
        typeof codeEditorsExtensionFacet
      > = {
        id: 'common.tab-size',
        matches: '*',
        extensions: EditorState.tabSize.of(2),
      }
      const _codeEditorsExtensionContribution2: InputOf<
        typeof codeEditorsExtensionFacet
      > = {
        id: 'kcl.read-only',
        matches: '.kcl',
        extensions: EditorState.readOnly.of(true),
      }
      await registry.configure([
        editorsExtension,
        kclExtension,
        markdownExtension,
        [
          contribute(
            codeEditorsExtensionFacet,
            () => _codeEditorsExtensionContribution
          ),
          contribute(
            codeEditorsExtensionFacet,
            () => _codeEditorsExtensionContribution2
          ),
        ],
      ])
      const editor = requireSuccess(
        registry.required(editorsService).openEditor(src, '')
      )
      expect(
        codeSurface(registry.required(editorsService), editor).state.tabSize
      ).toBe(2)
      expect(
        codeSurface(registry.required(editorsService), editor).state.readOnly
      ).toBe(isKcl)
    }
  )
  it('reconfigures live contributions without losing edits, selection or history', async () => {
    const slot = createSlot([], Symbol())
    const readOnly = (matches: '.kcl' | '.md' | '*') => {
      const _codeEditorsExtensionContribution3: InputOf<
        typeof codeEditorsExtensionFacet
      > = {
        id: 'read-only',
        matches,
        extensions: EditorState.readOnly.of(true),
      }
      return [
        contribute(
          codeEditorsExtensionFacet,
          () => _codeEditorsExtensionContribution3
        ),
      ]
    }
    await registry.configure([
      editorsExtension,
      markdownExtension,
      defineFactory({
        ...slot,
        create: () => ({
          items: [],
        }),
      }),
    ])
    const service = registry.required(editorsService)
    const first = requireSuccess(service.openEditor('/main.kcl', ''))
    const second = requireSuccess(service.openEditor('/main.kcl', ''))
    const markdown = requireSuccess(
      service.openEditor('cloud:project/notes.md', '')
    )
    const view = codeSurface(registry.required(editorsService), first)
    view.dispatch({
      changes: {
        from: 0,
        insert: 'hello',
      },
      selection: {
        anchor: 3,
      },
    })
    const dispatch = vi.spyOn(view, 'dispatch')
    await registry.replace(slot, [readOnly('.md')])
    expect(
      codeSurface(registry.required(editorsService), markdown).state.readOnly
    ).toBe(true)
    expect(view.state.readOnly).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
    await registry.replace(slot, [readOnly('.kcl')])
    expect(
      codeSurface(registry.required(editorsService), markdown).state.readOnly
    ).toBe(false)
    expect(view.state.readOnly).toBe(true)
    expect(
      codeSurface(registry.required(editorsService), second).state.readOnly
    ).toBe(true)
    expect(
      codeSurface(
        registry.required(editorsService),
        second
      ).state.doc.toString()
    ).toBe('')
    expect(service.editors.value[0]).toBe(first)
    expect(codeSurface(registry.required(editorsService), first)).toBe(view)
    expect(view.state.doc.toString()).toBe('hello')
    expect(view.state.selection.main.anchor).toBe(3)
    await registry.replace(slot, [readOnly('*')])
    expect(
      codeSurface(registry.required(editorsService), markdown).state.readOnly
    ).toBe(true)
    await registry.replace(slot, [])
    expect(
      codeSurface(registry.required(editorsService), markdown).state.readOnly
    ).toBe(false)
    expect(view.state.readOnly).toBe(false)
    expect(first.undo()).toBe(true)
    expect(view.state.doc.toString()).toBe('')
  })
  it('names a new buffer without replacing its document, history, or default surface', async () => {
    const service = registry.required(editorsService)
    const command = registry
      .get(commandsFacet)
      .find((command) => command.id === NEW_EDITOR_COMMAND.id)!
    await command.onSubmit?.()
    const editor = service.editors.value[0]
    const view = codeSurface(registry.required(editorsService), editor)
    expect(editor.src.value).toBeUndefined()
    expect(editor.classification.value).toBeUndefined()
    expect(
      service.viewState(presentation(registry.required(editorsService), editor))
        .value.selected?.id
    ).toBe('editors.code')
    view.dispatch({
      changes: {
        from: 0,
        insert: '# New buffer',
      },
      selection: {
        anchor: 3,
      },
    })
    service.setSource(editor.id, '/new.MD')
    expect(editor.src.value).toBe('/new.MD')
    expect(editor.classification.value).toEqual({
      languageId: 'markdown',
      mediaType: 'text/markdown',
    })
    expect(view.state.facet(language)?.name).toBe('markdown')
    expect(codeSurface(registry.required(editorsService), editor)).toBe(view)
    expect(view.state.selection.main.anchor).toBe(3)
    expect(readFile).not.toHaveBeenCalled()
    expect(editor.undo()).toBe(true)
    expect(editor.contents.value).toBe('')
  })
  it('reclassifies renamed sources and preserves the view, contents, and history', () => {
    const service = registry.required(editorsService)
    const editor = requireSuccess(service.openEditor('/notes.MD', '# Heading'))
    const view = codeSurface(registry.required(editorsService), editor)
    expect(view.state.facet(language)?.name).toBe('markdown')
    const sources: (string | undefined)[] = []
    const languages: (string | undefined)[] = []
    const stopSource = editor.src.subscribe((src) => sources.push(src))
    const stopLanguage = editor.classification.subscribe((value) =>
      languages.push(value?.languageId)
    )
    view.dispatch({
      changes: {
        from: 0,
        insert: 'prefix ',
      },
      selection: {
        anchor: 3,
      },
    })
    service.setSource(editor.id, '/parts/model.KCL')
    expect(editor.src.value).toBe('/parts/model.KCL')
    expect(editor.classification.value).toEqual({
      languageId: 'kcl',
    })
    expect(view.state.facet(language)?.name).toBe('kcl')
    expect(codeSurface(registry.required(editorsService), editor)).toBe(view)
    expect(view.state.doc.toString()).toBe('prefix # Heading')
    expect(view.state.selection.main.anchor).toBe(3)
    service.setSource(editor.id, '/moved/model.kcl')
    expect(sources).toEqual([
      '/notes.MD',
      '/parts/model.KCL',
      '/moved/model.kcl',
    ])
    expect(languages).toContain('markdown')
    expect(languages.at(-1)).toBe('kcl')
    expect(editor.undo()).toBe(true)
    expect(view.state.doc.toString()).toBe('# Heading')
    service.setSource(editor.id, '/README')
    expect(editor.classification.value).toBeUndefined()
    service.closeEditor(editor.id)
    service.setSource(editor.id, '/closed.md')
    expect(editor.src.value).toBe('/README')
    stopSource()
    stopLanguage()
  })
  it('destroys closed views and stops updating them on registry changes', async () => {
    const slot = createSlot([], Symbol())
    await registry.configure([
      editorsExtension,
      markdownExtension,
      defineFactory({
        ...slot,
        create: () => ({
          items: [],
        }),
      }),
    ])
    const service = registry.required(editorsService)
    const closed = requireSuccess(service.openEditor('/main.kcl', ''))
    const open = requireSuccess(service.openEditor('/main.kcl', ''))
    const closedDestroy = vi.spyOn(
      codeSurface(registry.required(editorsService), closed),
      'destroy'
    )
    const openDestroy = vi.spyOn(
      codeSurface(registry.required(editorsService), open),
      'destroy'
    )
    const closedDispatch = vi.spyOn(
      codeSurface(registry.required(editorsService), closed),
      'dispatch'
    )
    service.closeEditor(closed.id)
    service.closeEditor(closed.id)
    expect(closedDestroy).toHaveBeenCalledOnce()
    const _codeEditorsExtensionContribution4: InputOf<
      typeof codeEditorsExtensionFacet
    > = {
      id: 'common.tab-size',
      matches: '*',
      extensions: EditorState.tabSize.of(2),
    }
    await registry.replace(slot, [
      [
        contribute(
          codeEditorsExtensionFacet,
          () => _codeEditorsExtensionContribution4
        ),
      ],
    ])
    expect(closedDispatch).not.toHaveBeenCalled()
    expect(
      codeSurface(registry.required(editorsService), open).state.tabSize
    ).toBe(2)
    await registry.dispose()
    expect(closedDestroy).toHaveBeenCalledOnce()
    expect(openDestroy).toHaveBeenCalledOnce()
    expect(service.editors.value).toEqual([])
  })
  it('updates a registered capability when its contributed signal changes', async () => {
    const capability = signal<CodeEditorExtension>({
      id: 'tab-size',
      matches: '.kcl',
      extensions: EditorState.tabSize.of(2),
    })
    await registry.configure([
      editorsExtension,
      kclExtension,
      markdownExtension,
      [contribute(codeEditorsExtensionFacet, () => capability.value)],
    ])
    const editor = requireSuccess(
      registry.required(editorsService).openEditor('/main.kcl', '')
    )
    expect(
      codeSurface(registry.required(editorsService), editor).state.tabSize
    ).toBe(2)
    capability.value = {
      ...capability.value,
      extensions: EditorState.tabSize.of(6),
    }
    expect(
      codeSurface(registry.required(editorsService), editor).state.tabSize
    ).toBe(6)
    capability.value = {
      ...capability.value,
      matches: '.md',
    }
    expect(
      codeSurface(registry.required(editorsService), editor).state.tabSize
    ).toBe(4) // this is the default value from CodeMirror, tabSize of 4
  })
  it('returns errors for creation after an editor or its service closes', async () => {
    const editors = registry.required(editorsService)
    const editor = requireSuccess(editors.createEditor())
    editors.closeEditor(editor.id)
    expect(editors.createView(editor)).toBeInstanceOf(Error)
    expect(editors.views.peek()).toHaveLength(0)
    await registry.dispose()
    expect(editors.createEditor()).toBeInstanceOf(Error)
    expect(editors.editors.peek()).toHaveLength(0)
  })
  it('keeps edits and other capabilities working when a newly matching capability fails', async () => {
    const failure = new Error('Capability initialization failed')
    const release = vi.fn()
    const startHealthy = vi.fn()
    const releaseHealthy = vi.fn()
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const _editorCapabilityContribution: InputOf<
        typeof editorCapabilityFacet
      > = {
        id: 'broken',
        matches: ({ contents }) => contents.startsWith('activate'),
        setup: ({ onDispose }) => {
          onDispose(release)
          throw failure
        },
      }
      const _editorCapabilityContribution2: InputOf<
        typeof editorCapabilityFacet
      > = {
        id: 'healthy',
        matches: ({ contents }) => contents.startsWith('activate'),
        setup: ({ onDispose }) => {
          startHealthy()
          onDispose(releaseHealthy)
        },
      }
      await registry.configure([
        editorsExtension,
        [
          contribute(
            editorCapabilityFacet,
            () => _editorCapabilityContribution
          ),
          contribute(
            editorCapabilityFacet,
            () => _editorCapabilityContribution2
          ),
        ],
      ])
      const editors = registry.required(editorsService)
      const editor = requireSuccess(editors.createEditor())
      expect(() =>
        editor.dispatch({
          changes: {
            from: 0,
            insert: 'activate',
          },
        })
      ).not.toThrow()
      expect(editor.contents.peek()).toBe('activate')
      expect(release).toHaveBeenCalledOnce()
      expect(report).toHaveBeenCalledWith(failure)
      expect(startHealthy).toHaveBeenCalledOnce()
      editor.dispatch({
        changes: {
          from: 8,
          insert: ' again',
        },
      })
      expect(report).toHaveBeenCalledTimes(1)
      editor.dispatch({
        changes: {
          from: 0,
          to: editor.state.doc.length,
          insert: '',
        },
      })
      editor.dispatch({
        changes: {
          from: 0,
          insert: 'activate',
        },
      })
      expect(report).toHaveBeenCalledTimes(2)
      editors.closeEditor(editor.id)
      expect(release).toHaveBeenCalledTimes(2)
      expect(releaseHealthy).toHaveBeenCalledTimes(2)
    } finally {
      report.mockRestore()
    }
  })
  it('keeps an editor open when initial capability setup returns an error', async () => {
    const failure = new Error('Capability initialization failed')
    const release = vi.fn()
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const _editorCapabilityContribution3: InputOf<
        typeof editorCapabilityFacet
      > = {
        id: 'broken',
        matches: '*',
        setup: ({ onDispose }) => {
          onDispose(release)
          return failure
        },
      }
      await registry.configure([
        editorsExtension,
        [
          contribute(
            editorCapabilityFacet,
            () => _editorCapabilityContribution3
          ),
        ],
      ])
      const editors = registry.required(editorsService)
      const editor = requireSuccess(editors.createEditor())
      expect(editors.editors.peek()).toContain(editor)
      expect(report).toHaveBeenCalledWith(failure)
      expect(release).toHaveBeenCalledOnce()
      editors.closeEditor(editor.id)
      expect(release).toHaveBeenCalledOnce()
    } finally {
      report.mockRestore()
    }
  })
})
