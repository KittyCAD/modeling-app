import { codeSurface } from '@src/lib/editors/testViews'
import '@src/lib/projectSession/next/testFeature'
import { Popover } from '@headlessui/react'
import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { OPEN_EDITOR_COMMAND } from '@src/lib/editors/commands'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import executorsExtension from '@src/lib/executors/registry'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import markdownExtension from '@src/lib/markdown/registry'
import type { OpenProjectSession } from '@src/lib/projectSession/next/contract'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { ProjectRoute } from '@src/lib/projectSession/next/ProjectRoute'
import { ProjectView } from '@src/lib/projectSession/next/ProjectView'
import type { Project } from '@src/lib/projectSession/next/types'
import projectSessionNextExtension from '@src/lib/projectSession/registry'
import savingExtension from '@src/lib/save/registry'
import { editorSaveService } from '@src/lib/save/registry/contract'
import settingsExtension from '@src/lib/settings/registry'
import tomlExtension from '@src/lib/toml/registry'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { MemoryRouter } from 'react-router-dom'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const registry = vi.hoisted(() => ({ get: vi.fn(), signal: vi.fn() }))
const commands = vi.hoisted(() => ({ send: vi.fn() }))
// "Next"-era panes can access ordinary editor views, but no modeling singleton.
vi.mock('@src/lib/boot', () => ({ useApp: () => ({ registry, commands }) }))

// Native popover placement is covered by ToolbarDropdownPanel's browser checks.
vi.mock('@src/components/ToolbarDropdownPanel', () => ({
  ToolbarDropdownPanel: ({ children }: PropsWithChildren) => (
    <Popover.Panel>
      <ul>{children}</ul>
    </Popover.Panel>
  ),
}))

function createSession(
  title: string,
  children: Project['contents']['children'] = []
): OpenProjectSession {
  return {
    signal: new AbortController().signal,
    project: signal({
      contents: { name: title, path: `/projects/${title}`, children },
      metadata: { title, readWriteAccess: false },
    }),
    files: { read: vi.fn(), write: vi.fn() },
  }
}

describe('project screen', () => {
  let services: Registry
  const readFile = vi.fn(async (_src: string) =>
    new TextEncoder().encode('loaded contents')
  )
  const writeFile = vi.fn(async (_path: string, _contents: unknown) => {})
  beforeAll(async () => {
    await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  })
  beforeEach(() => {
    vi.clearAllMocks()
    services = new Registry()
    services.configure([
      editorsExtension,
      executorsExtension,
      markdownExtension,
      savingExtension,
      settingsExtension,
      tomlExtension,
      projectSessionNextExtension,
      defineRegistryItem({
        providesServices: [
          provideService(fileOperationsService, {
            ...testFileOperations,
            readFile,
            writeFile,
          }),
        ],
      }),
    ])
    registry.get.mockImplementation((service) => services.get(service))
    registry.signal.mockImplementation((spec) => services.signal(spec))
  })
  afterEach(() => {
    cleanup()
    services[Symbol.dispose]()
  })

  it('refreshes the real project header only after its root settings file saves successfully', async () => {
    const projects = services.get(projectSessionService)
    const session = projects.openProject({
      contents: { name: 'folder', path: '/projects/folder', children: [] },
      metadata: {
        title: 'Before',
        defaultFile: 'old.kcl',
        readWriteAccess: true,
      },
    })
    const editor = services
      .get(editorsService)
      .openEditor('/projects/folder/project.toml', 'title = "Before"')
    services.get(editorsService).createView(editor)
    render(
      <MemoryRouter>
        <ProjectView session={session} />
      </MemoryRouter>
    )
    const title = await screen.findByRole('textbox', { name: 'title' })
    fireEvent.change(title, { target: { value: 'After' } })
    fireEvent.blur(title)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Before' })
    ).toBeVisible()
    writeFile.mockRejectedValueOnce(new Error('Write failed'))
    await act(async () => {
      await services.get(editorSaveService).save(editor)
    })
    expect(
      screen.getByRole('heading', { level: 1, name: 'Before' })
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Save file' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'After' })
    ).toBeVisible()
    expect(session.project.value.metadata.defaultFile).toBeUndefined()
    expect(writeFile).toHaveBeenLastCalledWith(
      '/projects/folder/project.toml',
      'title = "After"'
    )
    const nested = services
      .get(editorsService)
      .openEditor('/projects/folder/sub/project.toml', 'title = "Nested"')
    await act(async () => {
      await services.get(editorSaveService).save(nested)
    })
    expect(session.project.value.metadata.title).toBe('After')
    // Removing the title follows the same directory-name fallback as opening a project.
    act(() =>
      editor.dispatch({
        changes: {
          from: 0,
          to: editor.state.doc.length,
          insert: '# no metadata',
        },
      })
    )
    await act(async () => {
      await services.get(editorSaveService).save(editor)
    })
    expect(
      screen.getByRole('heading', { level: 1, name: 'folder' })
    ).toBeVisible()
  })

  it('does not apply a completed save to a replacement opening of the same project', async () => {
    const projects = services.get(projectSessionService)
    const data = {
      contents: { name: 'folder', path: '/projects/folder', children: [] },
      metadata: { title: 'Before', readWriteAccess: true },
    }
    projects.openProject(data)
    const editor = services
      .get(editorsService)
      .openEditor('/projects/folder/project.toml', 'title = "Stale"')
    services.get(editorsService).createView(editor)
    let finish!: () => void
    writeFile.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve
      })
    )
    const save = services.get(editorSaveService).save(editor)
    await Promise.resolve()
    const replacement = projects.openProject(data)
    finish()
    await save
    expect(replacement.project.value.metadata.title).toBe('Before')
  })

  it('shows the captured project without reading or writing files', () => {
    const session = createSession('Bracket', [
      { name: 'main.kcl', path: '/projects/Bracket/main.kcl', children: null },
      { name: 'parts', path: '/projects/Bracket/parts', children: [] },
    ])
    render(
      <MemoryRouter>
        <ProjectView session={session} />
      </MemoryRouter>
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Bracket' })
    ).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toHaveTextContent(
      '/projects/Bracket'
    )
    expect(screen.getByText('Read-only')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute(
      'href',
      '/home'
    )
    expect(session.files.read).not.toHaveBeenCalled()
    expect(session.files.write).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
  })

  it('shows the editor area and follows the project session selection', () => {
    const first = createSession('First')
    const second = createSession('Second')
    const currentSession = signal<OpenProjectSession | undefined>(first)
    registry.get.mockImplementation((service) =>
      service === projectSessionService
        ? { currentSession, listFiles: () => [] }
        : services.get(service)
    )
    registry.signal.mockImplementation((service) =>
      service === projectSessionService
        ? { value: { currentSession, listFiles: () => [] } }
        : services.signal(service)
    )
    render(
      <MemoryRouter>
        <ProjectRoute />
      </MemoryRouter>
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'First' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('main', { name: 'Editor views' })
    ).toBeInTheDocument()
    act(() => {
      currentSession.value = second
    })
    expect(
      screen.getByRole('heading', { level: 1, name: 'Second' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { level: 1, name: 'First' })
    ).not.toBeInTheDocument()
  })

  it('launches the open-editor command and preserves buffers across project-view remounts', async () => {
    const project = createSession('Bracket', [
      { name: 'main.kcl', path: '/projects/Bracket/main.kcl', children: null },
    ])
    const session = services
      .get(projectSessionService)
      .openProject(project.project.value)
    const mounted = render(
      <MemoryRouter>
        <ProjectView session={session} />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open editor' }))
    expect(commands.send).toHaveBeenCalledWith({
      type: 'Find and select command',
      data: {
        name: OPEN_EDITOR_COMMAND.name,
        groupId: OPEN_EDITOR_COMMAND.groupId,
      },
    })
    const command = services
      .get(commandsValueSpec)
      .find(({ id }) => id === OPEN_EDITOR_COMMAND.id)!
    await act(async () => {
      await command.onSubmit({ src: '/projects/Bracket/main.kcl' })
    })
    const editor = services.get(editorsService).editors.value[0]
    expect(editor.contents.value).toBe('loaded contents')
    expect(readFile).toHaveBeenCalledWith('/projects/Bracket/main.kcl')
    expect(screen.getByRole('tab', { name: 'main.kcl' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('tabpanel')).toContainElement(
      codeSurface(services.get(editorsService), editor).dom
    )
    const destroy = vi.spyOn(
      codeSurface(services.get(editorsService), editor),
      'destroy'
    )
    mounted.unmount()
    expect(destroy).not.toHaveBeenCalled()
    render(
      <MemoryRouter>
        <ProjectView session={session} />
      </MemoryRouter>
    )
    expect(screen.getByRole('tabpanel')).toContainElement(
      codeSurface(services.get(editorsService), editor).dom
    )
  })

  it('opens Markdown as an editor mode and updates its contributed preview from unsaved edits', async () => {
    readFile.mockResolvedValueOnce(
      new TextEncoder().encode('# Project notes\n\n**Live** preview')
    )
    const project = createSession('Notes', [
      { name: 'README.md', path: '/projects/Notes/README.md', children: null },
      { name: 'main.kcl', path: '/projects/Notes/main.kcl', children: null },
    ])
    const session = services
      .get(projectSessionService)
      .openProject(project.project.value)
    render(
      <MemoryRouter>
        <ProjectView session={session} />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open editor' }))
    expect(commands.send).toHaveBeenCalledWith({
      type: 'Find and select command',
      data: {
        name: OPEN_EDITOR_COMMAND.name,
        groupId: OPEN_EDITOR_COMMAND.groupId,
      },
    })
    const command = services
      .get(commandsValueSpec)
      .find(({ id }) => id === OPEN_EDITOR_COMMAND.id)!
    await act(async () => {
      await command.onSubmit({ src: '/projects/Notes/README.md' })
    })
    expect(screen.getByRole('tab', { name: 'README.md' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(
      await screen.findByRole('heading', { name: 'Project notes' })
    ).toBeVisible()
    const editor = services.get(editorsService).editors.value[0]
    expect(editor.src.value).toBe('/projects/Notes/README.md')
    act(() => {
      editor.dispatch({
        changes: {
          from: 0,
          to: editor.state.doc.length,
          insert: '# Updated notes',
        },
      })
    })
    expect(
      await screen.findByRole('heading', { name: 'Updated notes' })
    ).toBeVisible()
    expect(readFile).toHaveBeenCalledOnce()
  })
})
