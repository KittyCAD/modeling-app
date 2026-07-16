import { Registry } from '@kittycad/registry'
import ProjectSidebarMenu from '@src/components/ProjectSidebarMenu'
import type { App } from '@src/lib/app'
import type { Project } from '@src/lib/project'
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
      systemIOActor: {
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

describe('project explorer project menu', () => {
  test('duplicates the current project', async () => {
    const { app, dispose } = createProjectMenuApp()

    try {
      renderWithRouter(
        <ProjectSidebarMenu app={app} enableMenu project={projectWellFormed} />
      )

      fireEvent.click(screen.getByTestId('project-sidebar-toggle'))
      const duplicateButton = (
        await screen.findByTestId('project-sidebar-duplicate-project')
      ).closest('button')

      expect(duplicateButton).not.toBeNull()
      if (!duplicateButton) return
      fireEvent.click(duplicateButton)

      expect(app.systemIOActor.send).toHaveBeenCalledWith({
        type: 'duplicate project',
        data: {
          projectName: projectWellFormed.name,
          requestedProjectName: projectWellFormed.title,
        },
      })
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
