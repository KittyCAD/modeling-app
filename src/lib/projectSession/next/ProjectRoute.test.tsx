import '@src/lib/projectSession/next/testFeature'
import { Popover } from '@headlessui/react'
import type { PropsWithChildren } from 'react'
import { signal } from '@preact/signals-core'
import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { OPEN_EXECUTOR_COMMAND } from '@src/lib/executors/commands'
import { OPEN_EDITOR_COMMAND } from '@src/lib/editors/commands'
import editorsExtension from '@src/lib/editors/registry'
import executorsExtension from '@src/lib/executors/registry'
import { executorsService } from '@src/lib/executors/registry/contract'
import markdownExtension from '@src/lib/markdown/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import projectSessionNextExtension from '@src/lib/projectSession/registry'
import type { Project } from '@src/lib/projectSession/next/types'
import type { OpenProjectSession } from '@src/lib/projectSession/next/contract'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { ProjectRoute } from '@src/lib/projectSession/next/ProjectRoute'
import { ProjectView } from '@src/lib/projectSession/next/ProjectView'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
    registry.get.mockImplementation((service) => services.get(service))
    registry.signal.mockImplementation((spec) => services.signal(spec))
  })
  afterEach(() => {
    cleanup()
    services[Symbol.dispose]()
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

  it('shows the modeling area and follows the project session selection', () => {
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
      screen.getByRole('main', { name: 'Executor view' })
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

  it('launches the open-editor command and preserves views when its sidebar pane is hidden', async () => {
    const project = createSession('Bracket', [
      { name: 'main.kcl', path: '/projects/Bracket/main.kcl', children: null },
    ])
    const session = services
      .get(projectSessionService)
      .openProject(project.project.value)
    render(
      <MemoryRouter>
        <ProjectView session={session} />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByTestId('next-editors-pane-button'))
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
    expect(editor.view.state.doc.toString()).toBe('loaded contents')
    expect(readFile).toHaveBeenCalledWith('/projects/Bracket/main.kcl')
    expect(screen.getByRole('tab', { name: 'main.kcl' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('tabpanel')).toContainElement(editor.view.dom)
    const destroy = vi.spyOn(editor.view, 'destroy')
    fireEvent.click(screen.getByTestId('next-editors-pane-button'))
    expect(
      screen.queryByRole('region', { name: 'Editors' })
    ).not.toBeInTheDocument()
    expect(destroy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('next-editors-pane-button'))
    expect(screen.getByRole('tabpanel')).toContainElement(editor.view.dom)
  })

  it('opens Markdown from the open-executor command and updates its contributed preview from unsaved edits', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Open executor' }))
    expect(commands.send).toHaveBeenCalledWith({
      type: 'Find and select command',
      data: {
        name: OPEN_EXECUTOR_COMMAND.name,
        groupId: OPEN_EXECUTOR_COMMAND.groupId,
      },
    })
    const command = services
      .get(commandsValueSpec)
      .find(({ id }) => id === OPEN_EXECUTOR_COMMAND.id)!
    await act(async () => {
      await command.onSubmit({ src: '/projects/Notes/README.md' })
    })
    expect(
      screen.getByRole('tab', { name: 'README.md - Markdown' })
    ).toHaveAttribute('aria-selected', 'true')
    expect(
      await screen.findByRole('heading', { name: 'Project notes' })
    ).toBeVisible()
    const editor = services.get(editorsService).editors.value[0]
    expect(editor.src.value).toBe('/projects/Notes/README.md')
    act(() => {
      editor.view.dispatch({
        changes: {
          from: 0,
          to: editor.view.state.doc.length,
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
