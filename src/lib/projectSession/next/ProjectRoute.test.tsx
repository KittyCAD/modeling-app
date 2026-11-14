import '@src/lib/projectSession/next/testFeature'
import { codeSurface } from '@src/lib/editors/testViews'
import { signal } from '@preact/signals-core'
import { factory, Registry, provide } from 'plankton'
import { OPEN_EDITOR_COMMAND } from '@src/lib/editors/commands'
import editorsExtension from '@src/lib/editors/registry'
import markdownExtension from '@src/lib/markdown/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { commandsFacet } from '@src/registry/contracts/commands'
import { createProjectSessionExtension } from '@src/lib/projectSession/registry'
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
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
const registry = vi.hoisted(() => ({
  get: vi.fn(),
  required: vi.fn(),
  optional: vi.fn(),
  observe: vi.fn(),
}))
const commands = vi.hoisted(() => ({
  send: vi.fn(),
}))
// "Next"-era panes can access ordinary editor views, but no modeling singleton.
vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    registry,
    commands,
  }),
}))
function createSession(
  title: string,
  children: Project['contents']['children'] = []
): OpenProjectSession {
  return {
    signal: new AbortController().signal,
    project: signal({
      contents: {
        name: title,
        path: `/projects/${title}`,
        children,
      },
      metadata: {
        title,
        readWriteAccess: false,
      },
    }),
    files: {
      read: vi.fn(),
      write: vi.fn(),
    },
  }
}
describe('project screen', () => {
  let services: Registry
  const readFile = vi.fn(async (_src: string) =>
    new TextEncoder().encode('loaded contents')
  )
  beforeAll(async () => {
    await moduleFsViaModuleImport({
      type: StorageName.NodeFS,
      options: {},
    })
  })
  beforeEach(async () => {
    vi.clearAllMocks()
    services = new Registry()
    await services.configure([
      editorsExtension,
      markdownExtension,
      createProjectSessionExtension(
        factory({
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
    registry.get.mockImplementation((facet) => services.get(facet))
    registry.required.mockImplementation((service) =>
      services.required(service)
    )
    registry.observe.mockImplementation((facet) => services.observe(facet))
    registry.optional.mockImplementation((service) =>
      services.optional(service)
    )
  })
  afterEach(async () => {
    cleanup()
    await services.dispose()
  })
  it('installs editor-owned native history when the new project shell opens', async () => {
    const original = window.electron
    const createEditorPageMenu = vi.fn(async () => {})
    window.electron = {
      os: {
        isMac: true,
      },
      createEditorPageMenu,
      menuOn: () => () => {},
    } as unknown as Window['electron']
    try {
      render(
        <MemoryRouter>
          <ProjectView session={createSession('Bracket')} />
        </MemoryRouter>
      )
      await vi.waitFor(() =>
        expect(createEditorPageMenu).toHaveBeenCalledOnce()
      )
    } finally {
      window.electron = original
    }
  })
  it('shows the captured project without reading or writing files', () => {
    const session = createSession('Bracket', [
      {
        name: 'main.kcl',
        path: '/projects/Bracket/main.kcl',
        children: null,
      },
      {
        name: 'parts',
        path: '/projects/Bracket/parts',
        children: [],
      },
    ])
    render(
      <MemoryRouter>
        <ProjectView session={session} />
      </MemoryRouter>
    )
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Bracket',
      })
    ).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toHaveTextContent(
      '/projects/Bracket'
    )
    expect(screen.getByText('Read-only')).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: 'Projects',
      })
    ).toHaveAttribute('href', '/home')
    expect(session.files.read).not.toHaveBeenCalled()
    expect(session.files.write).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
  })
  it('shows the workspace and follows the project session selection', () => {
    const first = createSession('First')
    const second = createSession('Second')
    const currentSession = signal<OpenProjectSession | undefined>(first)
    registry.required.mockImplementation((service) =>
      service === projectSessionService
        ? {
            currentSession,
            listFiles: () => [],
          }
        : services.required(service)
    )
    registry.optional.mockImplementation((service) =>
      service === projectSessionService
        ? {
            currentSession,
            listFiles: () => [],
          }
        : services.optional(service)
    )
    render(
      <MemoryRouter>
        <ProjectRoute />
      </MemoryRouter>
    )
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'First',
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('main', {
        name: 'Editor views',
      })
    ).toBeInTheDocument()
    act(() => {
      currentSession.value = second
    })
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Second',
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', {
        level: 1,
        name: 'First',
      })
    ).not.toBeInTheDocument()
  })
  it('launches the open-editor command and preserves buffers when the workspace remounts', async () => {
    const project = createSession('Bracket', [
      {
        name: 'main.kcl',
        path: '/projects/Bracket/main.kcl',
        children: null,
      },
    ])
    const session = services
      .required(projectSessionService)
      .openProject(project.project.value)
    const workspace = render(
      <MemoryRouter>
        <ProjectView session={session} />
      </MemoryRouter>
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open editor',
      })
    )
    expect(commands.send).toHaveBeenCalledWith({
      type: 'Find and select command',
      data: {
        name: OPEN_EDITOR_COMMAND.name,
        groupId: OPEN_EDITOR_COMMAND.groupId,
      },
    })
    const command = services
      .get(commandsFacet)
      .find(({ id }) => id === OPEN_EDITOR_COMMAND.id)!
    await act(async () => {
      await command.onSubmit({
        src: '/projects/Bracket/main.kcl',
      })
    })
    const editor = services.required(editorsService).editors.value[0]
    expect(editor.contents.value).toBe('loaded contents')
    expect(readFile).toHaveBeenCalledWith('/projects/Bracket/main.kcl')
    expect(
      screen.getByRole('tab', {
        name: 'main.kcl',
      })
    ).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toContainElement(
      codeSurface(services.required(editorsService), editor).dom
    )
    const destroy = vi.spyOn(
      codeSurface(services.required(editorsService), editor),
      'destroy'
    )
    workspace.unmount()
    expect(destroy).not.toHaveBeenCalled()
    render(
      <MemoryRouter>
        <ProjectView session={session} />
      </MemoryRouter>
    )
    expect(screen.getByRole('tabpanel')).toContainElement(
      codeSurface(services.required(editorsService), editor).dom
    )
  })
})
