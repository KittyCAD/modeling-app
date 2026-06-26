import { Popover } from '@headlessui/react'
import { Registry } from '@kittycad/registry'
import type { App } from '@src/lib/app'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { createActor, createMachine } from 'xstate'

import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import { PATHS } from '@src/lib/paths'
import type { FileEntry, Project } from '@src/lib/project'
import projectExplorerExtension from '@src/registry/extensions/projectExplorer'

import ProjectSidebarMenu, {
  ProjectBreadcrumbButton,
  canNavigateHome,
} from '@src/components/ProjectSidebarMenu'

const originalElectron = window.electron

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

afterEach(() => {
  window.electron = originalElectron
  vi.restoreAllMocks()
})

const now = Date.now()
const projectWellFormed = {
  name: '550e8400-e29b-41d4-a716-446655440000',
  title: 'Simple Box',
  path: '/some/path/550e8400-e29b-41d4-a716-446655440000',
  children: [
    {
      name: 'main.kcl',
      path: '/some/path/550e8400-e29b-41d4-a716-446655440000/main.kcl',
      children: [],
    },
  ],
  readWriteAccess: true,
  metadata: {
    created: now,
    modified: now,
    size: 32,
    accessed: null,
    type: null,
    permission: null,
  },
  kcl_file_count: 1,
  directory_count: 0,
  default_file: '/some/path/550e8400-e29b-41d4-a716-446655440000/main.kcl',
} satisfies Project

const nestedFile = {
  name: 'nested-part.kcl',
  path: '/some/path/550e8400-e29b-41d4-a716-446655440000/parts/generated/nested-part.kcl',
  children: null,
} satisfies FileEntry

function renderWithRouter(children: ReactNode) {
  return render(<BrowserRouter>{children}</BrowserRouter>)
}

function renderBreadcrumb() {
  return render(
    <Popover>
      <ProjectBreadcrumbButton project={projectWellFormed} file={nestedFile} />
    </Popover>
  )
}

function createProjectMenuApp() {
  const registry = new Registry()
  registry.configure([projectExplorerExtension])
  const commandsActor = createActor(
    createMachine({
      context: {
        commands: [],
      },
    })
  ).start()

  return {
    app: {
      machineManager: {
        machines: [],
      },
      commands: {
        actor: commandsActor,
        send: vi.fn(),
      },
      settings: {
        actor: {},
        useSettings: () => ({
          app: {
            machineApi: {
              current: false,
            },
          },
        }),
      },
      registry,
    } as unknown as App,
    dispose: () => {
      commandsActor.stop()
      registry[Symbol.dispose]()
    },
  }
}

describe('ProjectSidebarMenu tests', () => {
  test('enables home navigation for desktop or cloud-backed web', () => {
    expect(
      canNavigateHome({ isDesktopApp: true, hasOpfsCloudFeature: false })
    ).toBe(true)
    expect(
      canNavigateHome({ isDesktopApp: false, hasOpfsCloudFeature: true })
    ).toBe(true)
    expect(
      canNavigateHome({ isDesktopApp: false, hasOpfsCloudFeature: false })
    ).toBe(false)
  })

  test('Disables popover menu by default', () => {
    renderWithRouter(<ProjectSidebarMenu project={projectWellFormed} />)

    expect(screen.getByTestId('project-name')).toHaveTextContent('Simple Box')
  })

  test('Links the logo to Home when home navigation is enabled', () => {
    renderWithRouter(
      <ProjectSidebarMenu project={projectWellFormed} hasOpfsCloudFeature />
    )

    const logoLink = screen.getByTestId('app-logo').closest('a')

    expect(logoLink).toHaveAttribute('href', PATHS.HOME)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Go home')
  })

  test('Reveals the current project from the project menu', async () => {
    const showInFolder = vi.fn()
    window.electron = {
      showInFolder,
      platform: 'darwin',
      os: {
        isMac: false,
      },
    } as unknown as Window['electron']
    const { app, dispose } = createProjectMenuApp()

    try {
      renderWithRouter(
        <ProjectSidebarMenu app={app} enableMenu project={projectWellFormed} />
      )

      fireEvent.click(screen.getByTestId('project-sidebar-toggle'))
      fireEvent.click(
        await screen.findByTestId('project-sidebar-reveal-in-file-explorer')
      )

      expect(showInFolder).toHaveBeenCalledWith(projectWellFormed.path)
    } finally {
      dispose()
    }
  })

  test('Shows the full project-relative file path in the breadcrumb', () => {
    renderBreadcrumb()

    expect(screen.getByTestId('app-header-file-name')).toHaveTextContent(
      'parts / generated / nested-part.kcl'
    )
  })

  test('Shows the full breadcrumb tooltip when the path is truncated', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(200)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100)

    renderBreadcrumb()

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Simple Box / parts / generated / nested-part.kcl'
    )
  })
})
