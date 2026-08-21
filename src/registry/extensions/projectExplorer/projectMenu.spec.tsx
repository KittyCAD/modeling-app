import {
  Registry,
  defineRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import ProjectSidebarMenu from '@src/components/ProjectSidebarMenu'
import type { App } from '@src/lib/app'
import { homeProjectEntryFromProject } from '@src/lib/homeProjects'
import type { Project } from '@src/lib/project'
import type { HomeProjectActionsService } from '@src/registry/contracts/homeProjects'
import {
  homeProjectActionsService,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import getDesktopAppExtension from '@src/registry/extensions/getDesktopApp'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createActor, createMachine } from 'xstate'
import projectExplorerExtension from '.'

const originalElectron = window.electron

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

function renderWithRouter(children: ReactNode) {
  return render(<BrowserRouter>{children}</BrowserRouter>)
}

function createHomeProjectActions(): HomeProjectActionsService {
  return {
    canOpen: vi.fn(() => true),
    canDuplicate: vi.fn(() => true),
    canRename: vi.fn(() => true),
    canDelete: vi.fn(() => true),
    canMoveToLibrary: vi.fn(() => false),
    canReviewDuplicateRealizations: vi.fn(() => false),
    open: vi.fn(async (project) => ({
      defaultFile: project.defaultFile ?? '',
    })),
    duplicate: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    getMoveToLibraryTargets: vi.fn(() => []),
    moveToLibrary: vi.fn(async () => undefined),
    deleteDuplicateRealizations: vi.fn(async () => undefined),
  }
}

function createProjectMenuApp() {
  const registry = new Registry()
  const homeProjectActions = createHomeProjectActions()
  const homeProjectEntry = homeProjectEntryFromProject(projectWellFormed)
  registry.configure([
    projectExplorerExtension,
    getDesktopAppExtension,
    defineRegistryItem({
      id: 'test-home-project-actions',
      providesServices: [
        provideService(homeProjectActionsService, homeProjectActions),
      ],
    }),
    defineRegistryItem({
      id: 'test-home-project-entries',
      provides: [
        provide(homeProjectEntriesValueSpec, {
          ...homeProjectEntry,
          id: `local:${projectWellFormed.path}`,
          libraryIds: ['test-library'],
        }),
      ],
    }),
  ])
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
    homeProjectActions,
    dispose: () => {
      commandsActor.stop()
      registry[Symbol.dispose]()
    },
  }
}

describe('project explorer project menu', () => {
  test('shows the contributed desktop app link on web', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome')
    const { app, dispose } = createProjectMenuApp()

    try {
      renderWithRouter(
        <ProjectSidebarMenu
          app={app}
          enableMenu
          project={projectWellFormed}
          hasCloudSyncFeature
        />
      )

      fireEvent.click(screen.getByTestId('project-sidebar-toggle'))
      const downloadLink = await screen.findByTestId(
        'project-menu-get-desktop-app'
      )

      expect(downloadLink).toHaveAttribute(
        'href',
        expect.stringContaining('/design-studio/download')
      )
      expect(screen.queryByLabelText('download')).not.toBeInTheDocument()
      expect(downloadLink.closest('li')?.nextElementSibling).toBe(
        screen.getByText('Go to Home').closest('li')
      )
    } finally {
      dispose()
    }
  })

  test('hides the contributed desktop app link on desktop', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Electron')
    const { app, dispose } = createProjectMenuApp()

    try {
      renderWithRouter(
        <ProjectSidebarMenu app={app} enableMenu project={projectWellFormed} />
      )

      fireEvent.click(screen.getByTestId('project-sidebar-toggle'))

      expect(
        screen.queryByTestId('project-menu-get-desktop-app')
      ).not.toBeInTheDocument()
    } finally {
      dispose()
    }
  })

  test('duplicates the current project', async () => {
    const { app, homeProjectActions, dispose } = createProjectMenuApp()

    try {
      renderWithRouter(
        <ProjectSidebarMenu app={app} enableMenu project={projectWellFormed} />
      )

      fireEvent.click(screen.getByTestId('project-sidebar-toggle'))
      const duplicateButton = (
        await screen.findByTestId('project-sidebar-duplicate-project')
      ).closest('button')

      expect(duplicateButton).not.toBeNull()
      if (!duplicateButton) {
        return
      }
      fireEvent.click(duplicateButton)

      expect(homeProjectActions.duplicate).toHaveBeenCalledWith(
        expect.objectContaining({
          localProjectPath: projectWellFormed.path,
          localProjectName: projectWellFormed.name,
        })
      )
    } finally {
      dispose()
    }
  })

  test('reveals the current project from the contributed menu item on desktop', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Electron')
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
})
